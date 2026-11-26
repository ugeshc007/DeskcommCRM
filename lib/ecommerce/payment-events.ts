import { createHash } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { paymentMatchesOrder } from './checkout';

export const checkoutEventSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9]+$/).max(100),
  type: z.enum(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired']),
  data: z.object({ object: z.object({
    id: z.string().regex(/^cs_[A-Za-z0-9_]+$/), payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
    status: z.enum(['open', 'complete', 'expired']), amount_total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[a-z]{3}$/), metadata: z.object({ order_id: z.uuid(), organization_id: z.uuid() }),
  }) }),
});

/** Só chamar APÓS HMAC válido ou GET autenticado ao provedor na reconciliação.
 * Org/conexão vêm do endpoint/cofre, nunca metadata do cliente. */
export async function applyCheckoutPaymentEvent(pool: Pick<pg.Pool, 'connect'>, scope: {
  organizationId: string; connectionId: string; revision: number;
}, raw: unknown) {
  const event = checkoutEventSchema.parse(raw), session = event.data.object;
  if (session.metadata.organization_id !== scope.organizationId) throw new Error('store_payment_owner_mismatch');
  const fingerprint = createHash('sha256').update(JSON.stringify(event)).digest('hex');
  const db = await pool.connect();
  try {
    await db.query('begin'); await db.query("set local lock_timeout='5s'"); await db.query("set local statement_timeout='15s'");
    const active = await db.query("select id from public.integration_connections where organization_id=$1 and id=$2 and revision=$3 and provider='stripe' and active for share", [scope.organizationId, scope.connectionId, scope.revision]);
    if (!active.rowCount) throw new Error('store_payment_connection_unavailable');
    const result = await db.query('select * from public.store_orders where organization_id=$1 and id=$2 and connection_id=$3 and connection_revision=$4 for update', [scope.organizationId, session.metadata.order_id, scope.connectionId, scope.revision]);
    const order = result.rows[0];
    if (!order) throw new Error('store_payment_owner_mismatch');
    const old = await db.query('select fingerprint,outcome from public.store_payment_events where organization_id=$1 and connection_id=$2 and event_id=$3', [scope.organizationId, scope.connectionId, event.id]);
    if (old.rowCount) {
      if (old.rows[0].fingerprint !== fingerprint) throw new Error('store_payment_event_conflict');
      await db.query('commit'); return { outcome: old.rows[0].outcome as string, duplicate: true };
    }
    if (!order.payment_session_id) throw new Error('store_payment_awaiting_reconciliation');
    if (order.payment_session_id !== session.id) throw new Error('store_payment_owner_mismatch');
    const paid = paymentMatchesOrder({ id: order.id, organization_id: order.organization_id, session_id: order.payment_session_id, total_cents: Number(order.total_cents), currency: order.currency }, {
      order_id: session.metadata.order_id, organization_id: session.metadata.organization_id, session_id: session.id,
      amount_total: session.amount_total, currency: session.currency, payment_status: session.payment_status,
    });
    let outcome: 'paid' | 'expired' | 'review' | 'ignored' = 'ignored';
    let nextStatus = order.status;
    if (order.status !== 'paid' && (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && session.payment_status === 'paid') {
      if (!paid || order.stock_state !== 'reserved' || ['cancelled', 'expired'].includes(order.status)) { outcome = 'review'; nextStatus = 'payment_review'; }
      else { outcome = 'paid'; nextStatus = 'paid'; }
    } else if (order.stock_state === 'reserved' && !['paid', 'cancelled', 'expired'].includes(order.status) && event.type === 'checkout.session.expired' && session.status === 'expired' && session.payment_status === 'unpaid' && session.amount_total === Number(order.total_cents) && session.currency.toUpperCase() === order.currency) {
      outcome = 'expired'; nextStatus = 'expired';
    } else if (event.type === 'checkout.session.async_payment_failed' && order.status !== 'paid') { outcome = 'review'; nextStatus = 'payment_review'; }
    if (outcome === 'paid' || outcome === 'expired') {
      const items = await db.query('select sku,quantity from public.store_order_items where organization_id=$1 and order_id=$2 order by sku', [scope.organizationId, order.id]);
      for (const item of items.rows) {
        const stock = await db.query(`update public.store_products set stock_reserved=stock_reserved-$3,
          stock_on_hand=stock_on_hand-$4 where organization_id=$1 and sku=$2 and stock_reserved >= $3 returning sku`,
        [scope.organizationId, item.sku, item.quantity, outcome === 'paid' ? item.quantity : 0]);
        if (!stock.rowCount) throw new Error('store_inventory_reconciliation_required');
      }
    }
    const stockState = outcome === 'paid' ? 'consumed' : outcome === 'expired' ? 'released' : order.stock_state;
    if (nextStatus !== order.status) await db.query('update public.store_orders set status=$3,stock_state=$4,updated_at=now() where organization_id=$1 and id=$2', [scope.organizationId, order.id, nextStatus, stockState]);
    await db.query('insert into public.store_payment_events(organization_id,connection_id,event_id,fingerprint,order_id,outcome) values($1,$2,$3,$4,$5,$6)', [scope.organizationId, scope.connectionId, event.id, fingerprint, order.id, outcome]);
    await db.query("insert into public.api_audit_log(organization_id,action,resource_type,resource_id,metadata,bypassed_rls) values($1,'store.payment_event','store_order',$2,$3::jsonb,true)", [scope.organizationId, order.id, JSON.stringify({ outcome })]);
    await db.query('commit'); return { outcome, duplicate: false };
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}
