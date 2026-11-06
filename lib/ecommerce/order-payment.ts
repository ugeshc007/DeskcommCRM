import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { loadConnection, readConnectionCredential } from '@/lib/integrations/management';
import { apiCredentialSchemas } from '@/lib/integrations/provider-credentials';
import type { CheckoutQuote } from './checkout';
import { createStripeCheckout } from './stripe-checkout';
import { assertStoreBot, type StoreBotContext } from './bot-authority';

/** Reprise du même ordre, jamais un second checkout après un timeout. */
export async function startOrderPayment(pool: Pick<pg.Pool, 'connect'>, vaultDb: SupabaseClient, scope: {
  organizationId: string; actorId: string; orderId: string; returnUrl: string; bot?: StoreBotContext;
}) {
  for (const value of [scope.organizationId, scope.actorId, scope.orderId]) z.uuid().parse(value);
  const db = await pool.connect(), lock = scope.organizationId + ':payment:' + scope.orderId;
  let locked = false;
  try {
    const acquired = await db.query('select pg_try_advisory_lock(hashtextextended($1,0)) acquired', [lock]);
    if (!acquired.rows[0]?.acquired) throw new Error('store_payment_in_progress');
    locked = true;
    await db.query('begin');
    const bot = scope.bot ? await assertStoreBot(db, scope.organizationId, scope.bot) : null;
    if (!bot) {
      const member = await db.query("select user_id from public.user_organizations where organization_id=$1 and user_id=$2 and role='admin' and accepted_at is not null and revoked_at is null for share", [scope.organizationId, scope.actorId]);
      if (!member.rowCount) throw new Error('store_forbidden');
    }
    const result = await db.query('select * from public.store_orders where organization_id=$1 and id=$2 for update', [scope.organizationId, scope.orderId]);
    const order = result.rows[0];
    if (!order) throw new Error('store_order_not_found');
    const customer = await db.query('select id from public.contacts where organization_id=$1 and id=$2 and not is_anonymized and not is_blocked for share', [scope.organizationId, order.contact_id]);
    if (!customer.rowCount) throw new Error('store_customer_unavailable');
    if (bot && (order.contact_id !== bot.contactId || !String(order.request_key).startsWith('bot:'))) throw new Error('store_bot_forbidden');
    if (order.status === 'paid') {
      await db.query('commit'); return { status: 'paid', payment_url: null };
    }
    // Même un lien déjà créé reste lié à la connexion et à sa révision actuelles.
    const active = await db.query("select id from public.integration_connections where organization_id=$1 and id=$2 and revision=$3 and provider='stripe' and active for share", [scope.organizationId, order.connection_id, order.connection_revision]);
    if (!active.rowCount) throw new Error('store_payment_connection_unavailable');
    // Ne jamais réémettre une création après la durée de vie de la réservation.
    // Le stock reste retenu jusqu'à une expiration confirmée par le fournisseur.
    if (new Date(order.expires_at).getTime() <= Date.now()) throw new Error('store_payment_reconciliation_required');
    if (order.status === 'awaiting_payment' && order.payment_url && order.stock_state === 'reserved') {
      await db.query('commit'); return { status: 'awaiting_payment', payment_url: order.payment_url as string };
    }
    if (order.stock_state !== 'reserved' || order.payment_session_id) throw new Error('store_payment_reconciliation_required');
    // Réservation et tentative sont durables AVANT l'appel réseau.
    await db.query("update public.store_orders set status='payment_review',updated_at=now() where organization_id=$1 and id=$2", [scope.organizationId, scope.orderId]);
    await db.query('commit');
    const connection = await loadConnection(vaultDb, scope.organizationId, order.connection_id);
    if (!connection?.active || connection.provider !== 'stripe' || connection.revision !== order.connection_revision) throw new Error('store_payment_connection_unavailable');
    const credential = apiCredentialSchemas.stripe.parse(JSON.parse(await readConnectionCredential(vaultDb, scope.organizationId, connection)));
    if (!credential.webhook_secret) throw new Error('store_payment_webhook_required');
    const current = await loadConnection(vaultDb, scope.organizationId, connection.id);
    if (!current?.active || current.revision !== connection.revision) throw new Error('store_payment_connection_unavailable');
    if (scope.bot) await assertStoreBot(db, scope.organizationId, scope.bot);
    else {
      const permission = await db.query("select user_id from public.user_organizations where organization_id=$1 and user_id=$2 and role='admin' and accepted_at is not null and revoked_at is null", [scope.organizationId, scope.actorId]);
      if (!permission.rowCount) throw new Error('store_forbidden');
    }
    const payment = await createStripeCheckout({ order_id: order.id, organization_id: scope.organizationId, token: credential.token,
      quote: order.quote as Extract<CheckoutQuote, { status: 'quoted' }>, expires_at: Math.floor(new Date(order.expires_at).getTime() / 1000), return_url: scope.returnUrl });
    await db.query('begin');
    const stillActive = await db.query('select id from public.integration_connections where organization_id=$1 and id=$2 and revision=$3 and active for share', [scope.organizationId, connection.id, connection.revision]);
    const status = stillActive.rowCount ? 'awaiting_payment' : 'payment_review';
    const saved = await db.query(`update public.store_orders set payment_session_id=$3,payment_url=$4,status=$5,updated_at=now()
      where organization_id=$1 and id=$2 and payment_session_id is null and stock_state='reserved' returning id`, [scope.organizationId, order.id, payment.session_id, payment.payment_url, status]);
    if (!saved.rowCount) throw new Error('store_payment_reconciliation_required');
    await db.query("insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id,metadata,bypassed_rls) values($1,$2,'store.payment_prepared','store_order',$3,$4::jsonb,true)", [scope.organizationId, scope.bot ? null : scope.actorId, order.id, JSON.stringify({ status })]);
    await db.query('commit');
    return { status, payment_url: status === 'awaiting_payment' ? payment.payment_url : null };
  } catch (error) { await db.query('rollback'); throw error; }
  finally {
    try { if (locked) await db.query('select pg_advisory_unlock(hashtextextended($1,0))', [lock]); }
    finally { db.release(); }
  }
}
