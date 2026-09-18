import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { loadConnection, readConnectionCredential } from '@/lib/integrations/management';
import { apiCredentialSchemas } from '@/lib/integrations/provider-credentials';
import { providerHttp } from '@/lib/integrations/provider-http';
import { applyCheckoutPaymentEvent, checkoutEventSchema } from './payment-events';

/** Opérateur récupère l'identité après timeout; le fournisseur prouve la liaison.
 * L'ID saisi ne vaut ni autorisation, ni preuve de paiement. */
export async function recoverOrderPayment(pool: Pick<pg.Pool, 'connect'>, vault: SupabaseClient,
  scope: { organizationId: string; actorId: string; orderId: string }, sessionId: string) {
  for (const value of [scope.organizationId, scope.actorId, scope.orderId]) z.uuid().parse(value);
  z.string().regex(/^cs_[A-Za-z0-9_]+$/).max(200).parse(sessionId);
  const db = await pool.connect(), org = scope.organizationId;
  try {
    const authorized = await db.query("select user_id from public.user_organizations where organization_id=$1 and user_id=$2 and role='admin' and revoked_at is null and accepted_at is not null", [org, scope.actorId]);
    if (!authorized.rowCount) throw new Error('store_forbidden');
    const order = (await db.query('select * from public.store_orders where organization_id=$1 and id=$2', [org, scope.orderId])).rows[0];
    if (!order || order.status !== 'payment_review' || order.stock_state !== 'reserved') throw new Error('store_payment_reconciliation_required');
    const connection = await loadConnection(vault, org, order.connection_id);
    if (!connection?.active || connection.provider !== 'stripe' || connection.revision !== order.connection_revision) throw new Error('store_payment_connection_unavailable');
    const credentials = apiCredentialSchemas.stripe.parse(JSON.parse(await readConnectionCredential(vault, org, connection)));
    const response = await providerHttp('https://api.stripe.com/v1/checkout/sessions/' + sessionId, 'GET', { Authorization: 'Bearer ' + credentials.token });
    if (response.status !== 200) throw new Error('store_payment_lookup_failed');
    const session = checkoutEventSchema.shape.data.shape.object.extend({ client_reference_id: z.string() }).parse(response.data);
    if (session.client_reference_id !== scope.orderId) throw new Error('store_payment_owner_mismatch');
    if (session.id !== sessionId || session.metadata.order_id !== scope.orderId || session.metadata.organization_id !== org || session.amount_total !== Number(order.total_cents) || session.currency.toUpperCase() !== order.currency) throw new Error('store_payment_owner_mismatch');
    const candidate = z.object({ url: z.string().nullable().optional() }).parse(response.data).url;
    const url = candidate ? new URL(candidate) : null;
    if (url && (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password)) throw new Error('store_payment_identity_invalid');
    await db.query('begin');
    const member = await db.query("select user_id from public.user_organizations where organization_id=$1 and user_id=$2 and role='admin' and revoked_at is null and accepted_at is not null for share", [org, scope.actorId]);
    if (!member.rowCount) throw new Error('store_forbidden');
    const active = await db.query('select id from public.integration_connections where organization_id=$1 and id=$2 and revision=$3 and active for share', [org, connection.id, connection.revision]);
    if (!active.rowCount) throw new Error('store_payment_connection_unavailable');
    const customer = await db.query('select id from public.contacts where organization_id=$1 and id=$2 and not is_anonymized for share', [org, order.contact_id]);
    if (!customer.rowCount) throw new Error('store_customer_unavailable');
    const changed = await db.query(`update public.store_orders set payment_session_id=$3,payment_url=$4,status=case when $4::text is not null then 'awaiting_payment' else 'payment_review' end,updated_at=now()
      where organization_id=$1 and id=$2 and status='payment_review' and stock_state='reserved'
      and (payment_session_id is null or payment_session_id=$3) returning id`, [org, scope.orderId, session.id, session.status === 'open' ? url?.toString() ?? null : null]);
    if (!changed.rowCount) throw new Error('store_payment_reconciliation_required');
    await db.query("select public.emit_event('store.payment_reconcile','store_order',$2,'{}','{}',$1)", [org, scope.orderId]);
    await db.query("insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id,metadata,bypassed_rls) values($1,$2,'store.payment_recovered','store_order',$3,'{}',true)", [org, scope.actorId, scope.orderId]);
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
  return { status: await reconcileStoreOrder(pool, vault, org, scope.orderId) };
}

/** Reconciliação só lê o provedor. Jamais cria outra sessão ou cobra cartão. */
export async function reconcileStoreOrder(pool: Pick<pg.Pool, 'connect'>, vault: SupabaseClient, org: string, id: string) {
  z.uuid().parse(org); z.uuid().parse(id);
  const db = await pool.connect();
  try {
    await db.query('begin');
    const order = (await db.query('select * from public.store_orders where organization_id=$1 and id=$2 for update', [org, id])).rows[0];
    if (!order || ['paid', 'expired', 'cancelled'].includes(order.status)) { await db.query('commit'); return 'done' as const; }
    if (order.status === 'reserved' && new Date(order.expires_at).getTime() <= Date.now()) {
      // Nenhuma tentativa foi iniciada: não há sessão pagável a expirar remotamente.
      if (order.payment_session_id || order.stock_state !== 'reserved') throw new Error('store_reconciliation_required');
      const items = await db.query('select sku,quantity from public.store_order_items where organization_id=$1 and order_id=$2 order by sku', [org, id]);
      for (const item of items.rows) {
        const updated = await db.query('update public.store_products set stock_reserved=stock_reserved-$3 where organization_id=$1 and sku=$2 and stock_reserved >= $3 returning sku', [org, item.sku, item.quantity]);
        if (!updated.rowCount) throw new Error('store_inventory_reconciliation_required');
      }
      await db.query("update public.store_orders set status='expired',stock_state='released',updated_at=now() where organization_id=$1 and id=$2", [org, id]);
      await db.query('commit'); return 'done' as const;
    }
    await db.query('commit');
    if (!order.payment_session_id) {
      if (order.status === 'payment_review') throw new Error('store_payment_unknown_review_required');
      return 'pending' as const;
    }
    if (!/^cs_[A-Za-z0-9_]+$/.test(order.payment_session_id)) throw new Error('store_payment_identity_invalid');
    const connection = await loadConnection(vault, org, order.connection_id);
    if (!connection?.active || connection.provider !== 'stripe' || connection.revision !== order.connection_revision) throw new Error('store_payment_connection_unavailable');
    const credentials = apiCredentialSchemas.stripe.parse(JSON.parse(await readConnectionCredential(vault, org, connection)));
    const response = await providerHttp('https://api.stripe.com/v1/checkout/sessions/' + order.payment_session_id, 'GET', { Authorization: 'Bearer ' + credentials.token });
    if (response.status !== 200) throw new Error('store_payment_lookup_failed');
    const session = checkoutEventSchema.shape.data.shape.object.parse(response.data);
    if (session.id !== order.payment_session_id || session.metadata.order_id !== id || session.metadata.organization_id !== org || session.amount_total !== Number(order.total_cents) || session.currency.toUpperCase() !== order.currency) throw new Error('store_payment_owner_mismatch');
    if (session.status === 'open' || session.payment_status === 'unpaid' && session.status !== 'expired') return 'pending' as const;
    const type = session.status === 'expired' ? 'checkout.session.expired' : 'checkout.session.completed';
    const event = { id: 'evt_' + createHash('sha256').update(JSON.stringify(session)).digest('hex'), type, data: { object: session } };
    const result = await applyCheckoutPaymentEvent(pool, { organizationId: org, connectionId: connection.id, revision: connection.revision }, event);
    if (result.outcome === 'review' || result.outcome === 'ignored') throw new Error('store_payment_review_required');
    return 'done' as const;
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}
