import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { cartRequestSchema } from './checkout';
import { authoritativeQuote } from './orders';
import { assertStoreBot, type StoreBotContext } from './bot-authority';

/** Une proposition par message source: une reprise ne crée pas deux consentements. */
export async function proposeBotCheckout(pool: Pick<pg.Pool, 'connect'>, org: string, bot: StoreBotContext, raw: unknown) {
  const cart = cartRequestSchema.parse(raw), db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("set local lock_timeout='5s'");
    const current = await assertStoreBot(db, org, bot);
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [org + ':quote:' + current.messageId]);
    const old = (await db.query('select id,cart,quote,confirmation,expires_at from public.store_checkout_proposals where organization_id=$1 and source_message_id=$2', [org, current.messageId])).rows[0];
    if (old) {
      if (JSON.stringify(old.cart) !== JSON.stringify(JSON.parse(JSON.stringify(cart)))) {
        // jsonb réordonne les clés: comparaison canonique via PostgreSQL.
        const same = await db.query('select cart=$3::jsonb same from public.store_checkout_proposals where organization_id=$1 and id=$2', [org, old.id, JSON.stringify(cart)]);
        if (!same.rows[0]?.same) throw new Error('store_proposal_conflict');
      }
      if (new Date(old.expires_at).getTime() <= Date.now()) throw new Error('store_proposal_expired');
      await db.query('commit'); return old;
    }
    const { quote, store } = await authoritativeQuote(db, org, cart, true);
    const id = randomUUID(), confirmation = 'CONFIRM ' + randomBytes(8).toString('hex').toUpperCase();
    const saved = await db.query(`insert into public.store_checkout_proposals
      (id,organization_id,contact_id,conversation_id,source_message_id,cart,quote,confirmation,expires_at)
      values($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,now()+make_interval(mins=>$9)) returning id,quote,confirmation,expires_at`,
    [id, org, current.contactId, current.conversationId, current.messageId, JSON.stringify(cart), JSON.stringify(quote), confirmation, store.reservation_minutes]);
    await db.query('commit'); return saved.rows[0];
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}
