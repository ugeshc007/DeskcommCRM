import { z } from 'zod';
import type { McpContext, McpToolDefinition } from '../types';
import { currentExecutionBoundary, currentExecutionJob } from '@/lib/atendimento/fronteira-server';
import { claimOfJob } from '@/lib/agent-engine/queue/claim';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { cartRequestSchema } from '@/lib/ecommerce/checkout';
import { proposeBotCheckout } from '@/lib/ecommerce/bot-checkout';
import { reserveBotOrder } from '@/lib/ecommerce/orders';
import { startOrderPayment } from '@/lib/ecommerce/order-payment';
import { assertStoreBot } from '@/lib/ecommerce/bot-authority';
import { env } from '@/lib/env';

function authority(ctx: McpContext) {
  const job = currentExecutionJob(), boundary = currentExecutionBoundary();
  const claim = job ? claimOfJob(job) : null;
  if (ctx.actor.type !== 'ai_agent' || !job || !boundary || !claim || job.organization_id !== ctx.organizationId || ctx.requestId !== job.id)
    throw new Error('store_native_inbound_required');
  return { jobId: job.id, claim, boundary };
}
function failure(error: unknown) {
  const code = error instanceof Error && /^store_[a-z_]+$/.test(error.message) ? error.message : 'store_checkout_unavailable';
  return { status: 'needs_review', code, message: 'Checkout could not complete. Do not claim an order was paid or create a replacement order. Ask a human to review if retrying the same proposal fails.' };
}
const quoteInput = { cart: cartRequestSchema };
export const crmQuoteStoreCheckout: McpToolDefinition<typeof quoteInput> = {
  name: 'crm_quote_store_checkout', category: 'write', requiresRole: 'ai_operator', requiresScope: 'mcp:write',
  description: 'Calculate the current customer’s exact store quote from server catalogue and delivery rules. Present the full quote and ask them to send the returned confirmation text verbatim. Does not reserve or charge. Native inbound agent only; organization must enable automatic checkout.',
  inputSchema: quoteInput,
  async handler(input, ctx) {
    try { return await proposeBotCheckout(getRequestPool(), ctx.organizationId, authority(ctx), input.cart); }
    catch (error) { return failure(error); }
  },
};
const confirmInput = { proposal_id: z.uuid() };
export const crmConfirmStoreCheckout: McpToolDefinition<typeof confirmInput> = {
  name: 'crm_confirm_store_checkout', category: 'write', requiresRole: 'ai_operator', requiresScope: 'mcp:write',
  description: 'Reserve stock and prepare a secure payment link for a previously quoted proposal. The server requires the actual latest customer message to exactly match the confirmation text; an AI assertion of agreement is not accepted. Retry only the same proposal. Never call a payment link proof of payment.',
  inputSchema: confirmInput,
  async handler(input, ctx) {
    try {
      const bot = authority(ctx), pool = getRequestPool();
      const order = await reserveBotOrder(pool, ctx.organizationId, bot, input.proposal_id);
      const payment = await startOrderPayment(pool, ctx.supabase, { organizationId: ctx.organizationId, actorId: ctx.actor.id,
        orderId: order.id, bot, returnUrl: new URL('/checkout/return', env.NEXT_PUBLIC_APP_URL).toString() });
      return { order_id: order.id, ...payment, message: 'Only paid means payment is verified. Send the provided link without modifying it. Delivery address is collected on the secure payment page.' };
    } catch (error) { return failure(error); }
  },
};
const statusInput = { order_id: z.uuid() };
export const crmStoreOrderStatus: McpToolDefinition<typeof statusInput> = {
  name: 'crm_store_order_status', category: 'read', requiresRole: 'ai_operator', requiresScope: 'mcp:read',
  description: 'Read the current customer’s server-verified native order status. Payment is confirmed only when status is paid. No other customer’s orders or payment URLs are returned.',
  inputSchema: statusInput,
  async handler(input, ctx) {
    const db = await getRequestPool().connect();
    try {
      await db.query('begin');
      const current = await assertStoreBot(db, ctx.organizationId, authority(ctx));
      const result = await db.query('select id,status,total_cents,currency from public.store_orders where organization_id=$1 and contact_id=$2 and id=$3', [ctx.organizationId, current.contactId, input.order_id]);
      await db.query('commit');
      return result.rows[0] ?? { status: 'not_found' };
    } catch (error) { await db.query('rollback'); return failure(error); }
    finally { db.release(); }
  },
};
