import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { cartRequestSchema, quoteCheckout } from './checkout';
import { assertStoreBot, type StoreBotContext } from './bot-authority';

export const reserveOrderSchema = z.strictObject({
  contact_id: z.uuid(), request_key: z.string().min(1).max(200),
  confirmed_quote: z.string().regex(/^[a-f0-9]{64}$/), cart: cartRequestSchema,
});

type Db = Pick<pg.PoolClient, 'query'>;
async function requireCurrentAdministrator(db: Db, org: string, actor: string) {
  const member = await db.query("select user_id from public.user_organizations where organization_id=$1 and user_id=$2 and role='admin' and accepted_at is not null and revoked_at is null for share", [org, actor]);
  if (!member.rowCount) throw new Error('store_forbidden');
}

export async function authoritativeQuote(db: Db, org: string, cart: z.infer<typeof cartRequestSchema>, lock: boolean) {
  if (lock) await db.query('select id from public.organizations where id=$1 for share', [org]);
  const setting = await db.query(`select s.*,o.onboarding_state,o.currency,o.timezone from public.store_settings s
    join public.organizations o on o.id=s.organization_id where s.organization_id=$1 ${lock ? 'for share of s,o' : ''}`, [org]);
  const store = setting.rows[0];
  if (!store?.active || !store.prices_include_all_taxes) throw new Error('store_checkout_not_configured');
  const rows = await db.query(`select sku,product,stock_on_hand,stock_reserved from public.store_products
    where organization_id=$1 and active and sku=any($2::text[]) order by sku ${lock ? 'for update' : ''}`, [org, [...new Set(cart.items.map(i => i.sku))]]);
  const products = rows.rows.map(row => ({ ...row.product, sku: row.sku,
    stock: row.stock_on_hand === null ? null : row.stock_on_hand - row.stock_reserved, variants: [] }));
  const quote = quoteCheckout({ request: cart, products, config: store.config,
    locale: { country_code: store.onboarding_state?.welcome?.country_code, currency: store.currency, timezone: store.timezone } });
  if (quote.status !== 'quoted') throw new Error('store_quote_' + quote.reason);
  return { store, quote };
}

/** Reserva atômica; não chama provedor, não declara pagamento nem envia mensagem. */
export async function reserveOrder(pool: Pick<pg.Pool, 'connect'>, organizationId: string, actorId: string, raw: unknown) {
  z.uuid().parse(actorId);
  return reserve(pool, organizationId, { actorId }, raw);
}

export async function reserveBotOrder(pool: Pick<pg.Pool, 'connect'>, org: string, bot: StoreBotContext, proposalId: string) {
  z.uuid().parse(proposalId);
  return reserve(pool, org, { bot, proposalId }, null);
}

async function reserve(pool: Pick<pg.Pool, 'connect'>, organizationId: string,
  authority: { actorId: string } | { bot: StoreBotContext; proposalId: string }, raw: unknown) {
  z.uuid().parse(organizationId);
  const actorId = 'actorId' in authority ? authority.actorId : null;
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("set local lock_timeout='5s'");
    await db.query("set local statement_timeout='15s'");
    if ('bot' in authority) {
      const current = await assertStoreBot(db, organizationId, authority.bot);
      const proposal = (await db.query(`select * from public.store_checkout_proposals
        where organization_id=$1 and id=$2 and contact_id=$3 and conversation_id=$4 for share`,
      [organizationId, authority.proposalId, current.contactId, current.conversationId])).rows[0];
      if (!proposal || new Date(proposal.expires_at).getTime() <= Date.now() ||
        current.createdAt.getTime() < new Date(proposal.created_at).getTime() ||
        current.messageId === proposal.source_message_id || current.body?.trim() !== proposal.confirmation)
        throw new Error('store_customer_confirmation_required');
      raw = { contact_id: current.contactId, request_key: 'bot:' + proposal.id,
        confirmed_quote: proposal.quote.fingerprint, cart: proposal.cart };
    } else await requireCurrentAdministrator(db, organizationId, authority.actorId);
  const input = reserveOrderSchema.parse(raw);
  const fingerprint = createHash('sha256').update(JSON.stringify({ contact_id: input.contact_id, confirmed_quote: input.confirmed_quote, cart: input.cart })).digest('hex');
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [organizationId + ':' + input.request_key]);
    const previous = await db.query('select id,status,request_fingerprint from public.store_orders where organization_id=$1 and request_key=$2', [organizationId, input.request_key]);
    if (previous.rowCount) {
      if (previous.rows[0].request_fingerprint !== fingerprint) throw new Error('store_order_conflict');
      await db.query('commit');
      return { id: previous.rows[0].id as string, status: previous.rows[0].status as string, created: false };
    }
    const customer = await db.query('select id from public.contacts where organization_id=$1 and id=$2 and not is_anonymized and not is_blocked and is_merged_into is null for share', [organizationId, input.contact_id]);
    if (!customer.rowCount) throw new Error('store_customer_unavailable');
    const { store, quote } = await authoritativeQuote(db, organizationId, input.cart, true);
    if (quote.fingerprint !== input.confirmed_quote) throw new Error('store_quote_changed');
    if (!store.config.payment_methods.includes('card') && !store.config.payment_methods.includes('payment_link')) throw new Error('store_payment_method_unavailable');
    const connected = await db.query("select id,revision from public.integration_connections where organization_id=$1 and id=$2 and provider='stripe' and active for share", [organizationId, store.payment_connection_id]);
    if (!connected.rowCount) throw new Error('store_payment_connection_unavailable');
    const id = randomUUID();
    await db.query(`insert into public.store_orders(id,organization_id,contact_id,request_key,request_fingerprint,quote,total_cents,currency,status,connection_id,connection_revision,expires_at)
      values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'reserved',$9,$10,now()+make_interval(mins=>$11))`,
    [id, organizationId, input.contact_id, input.request_key, fingerprint, JSON.stringify(quote), quote.total_cents, quote.currency, connected.rows[0].id, connected.rows[0].revision, store.reservation_minutes]);
    for (const item of quote.items) {
      const changed = await db.query('update public.store_products set stock_reserved=stock_reserved+$3 where organization_id=$1 and sku=$2 and stock_on_hand-stock_reserved >= $3 returning sku', [organizationId, item.sku, item.quantity]);
      if (!changed.rowCount) throw new Error('store_stock_changed');
      await db.query('insert into public.store_order_items(organization_id,order_id,sku,quantity) values($1,$2,$3,$4)', [organizationId, id, item.sku, item.quantity]);
    }
    await db.query("select public.emit_event('store.payment_reconcile','store_order',$2,'{}','{}',$1)", [organizationId, id]);
    await db.query("insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id,metadata,bypassed_rls) values($1,$2,'store.order_reserved','store_order',$3,'{}',true)", [organizationId, actorId, id]);
    await db.query('commit');
    return { id, status: 'reserved', created: true };
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}

export async function previewOrder(pool: Pick<pg.Pool, 'connect'>, organizationId: string, actorId: string, raw: unknown) {
  z.uuid().parse(organizationId); z.uuid().parse(actorId);
  const cart = cartRequestSchema.parse(raw), db = await pool.connect();
  try {
    await db.query('begin read only');
    // Não trava registros numa transação de leitura; a reserva revalida autoridade.
    const member = await db.query("select user_id from public.user_organizations where organization_id=$1 and user_id=$2 and role='admin' and accepted_at is not null and revoked_at is null", [organizationId, actorId]);
    if (!member.rowCount) throw new Error('store_forbidden');
    const { quote } = await authoritativeQuote(db, organizationId, cart, false);
    await db.query('commit'); return quote;
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}
