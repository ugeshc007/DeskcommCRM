import { z } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { env } from '@/lib/env';
import { ok, fail } from '@/lib/api/wrappers';
import { readIntegrationJson } from '../integration-connections/_shared';
import { cartRequestSchema } from '@/lib/ecommerce/checkout';
import { previewOrder, reserveOrder, reserveOrderSchema } from '@/lib/ecommerce/orders';
import { startOrderPayment } from '@/lib/ecommerce/order-payment';
import { recoverOrderPayment } from '@/lib/ecommerce/reconcile';

const requestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('preview'), cart: cartRequestSchema }),
  z.strictObject({ operation: z.literal('reserve'), order: reserveOrderSchema }),
  z.strictObject({ operation: z.literal('payment'), order_id: z.uuid() }),
  z.strictObject({ operation: z.literal('recover'), order_id: z.uuid(), session_id: z.string().regex(/^cs_[A-Za-z0-9_]+$/).max(200) }),
]);

export async function POST(req: Request) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('admin'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use an organization administrator account for checkout.', 403);
  try {
    const input = requestSchema.parse(await readIntegrationJson(req)), pool = getRequestPool();
    const result = input.operation === 'preview' ? await previewOrder(pool, auth.org.orgId, auth.user.id, input.cart)
      : input.operation === 'reserve' ? await reserveOrder(pool, auth.org.orgId, auth.user.id, input.order)
        : input.operation === 'recover' ? await recoverOrderPayment(pool, createAdminClient(), { organizationId: auth.org.orgId, actorId: auth.user.id, orderId: input.order_id }, input.session_id)
        : await startOrderPayment(pool, createAdminClient(), { organizationId: auth.org.orgId, actorId: auth.user.id,
          orderId: input.order_id, returnUrl: new URL('/checkout/return', env.NEXT_PUBLIC_APP_URL).toString() });
    return ok(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return fail('validation_failed', 'Review the checkout fields.', 422);
    const code = error instanceof Error ? error.message : '';
    if (code === 'invalid_request') return fail('validation_failed', 'The checkout request is missing or too large.', 422);
    if (code === 'store_forbidden') return fail('forbidden', 'Current administrator access is required.', 403);
    if (code === 'store_order_not_found') return fail('not_found', 'Order not found.', 404);
    const messages: Record<string, string> = {
      store_quote_changed: 'The quote changed. Review the new price before confirming again.',
      store_order_conflict: 'This request was already used for a different order. Refresh before retrying.',
      store_checkout_not_configured: 'Configure and enable store checkout before creating orders.',
      store_customer_unavailable: 'Select an available customer from this organization.',
      store_payment_connection_unavailable: 'Test the organization’s payment connection before continuing.',
      store_payment_webhook_required: 'Configure the payment webhook signing secret before creating a payment session.',
      store_payment_in_progress: 'Payment preparation is already running. Refresh this order.',
      store_payment_reconciliation_required: 'This payment needs review. Do not create another order to retry it.',
      store_payment_uncertain: 'The payment provider response is uncertain. Review this order; retry only this same order.',
      store_payment_rejected: 'The payment provider rejected checkout. Review the connection and order settings.',
      store_payment_owner_mismatch: 'That payment session does not match this organization, order, amount and currency.',
      store_payment_lookup_failed: 'The provider could not verify this session. No order or stock state was changed.',
    };
    if (messages[code]) return fail('state_conflict', messages[code], 409);
    if (code.startsWith('store_quote_') || code === 'store_stock_changed' || code === 'store_payment_method_unavailable')
      return fail('validation_failed', 'A verified product, stock, currency, payment method or delivery quote is unavailable. Ask a human to review.', 422);
    return fail('service_unavailable', 'Checkout could not be confirmed. Refresh before retrying; do not assume an order was paid.', 503);
  }
}
