import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { emptyStoreConfig } from '@/lib/ecommerce/config';
import { previewOrder, reserveOrder } from '@/lib/ecommerce/orders';
import { applyCheckoutPaymentEvent } from '@/lib/ecommerce/payment-events';
import { proposeBotCheckout } from '@/lib/ecommerce/bot-checkout';
import { reserveBotOrder } from '@/lib/ecommerce/orders';
import { readCurrentServiceBoundary } from '@/lib/atendimento/fronteira-server';
import type { StoreBotContext } from '@/lib/ecommerce/bot-authority';

if (!process.env.TEST_DB_CONTAINER) throw new Error('Run through scripts/test-db.sh');
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres` });
afterAll(() => pool.end());
beforeAll(async () => {
  expect((await pool.query("select to_regclass('public.store_orders') relation")).rows[0].relation).toBeNull();
  await pool.query('select fn_provision_checkout_module()');
  await pool.query('select fn_provision_checkout_module()');
});
async function fixture() {
  const org = randomUUID(), actor = randomUUID(), connection = randomUUID(), contact = randomUUID();
  await pool.query(`insert into organizations(id,slug,legal_name,display_name,currency,timezone,onboarding_state)
    values($1,$2::text,$2::text,$2::text,'AED','Asia/Dubai','{"welcome":{"country_code":"AE"}}')`, [org, `synthetic-${org}`]);
  await pool.query('insert into auth.users(id,email) values($1,$2)', [actor, `${actor}@synthetic.test`]);
  await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'admin',now())", [actor, org]);
  await pool.query("insert into contacts(id,organization_id,display_name) values($1,$2,'Synthetic customer')", [contact, org]);
  await pool.query("insert into integration_connections(id,organization_id,provider,label,active) values($1,$2,'stripe','Synthetic payment',true)", [connection, org]);
  const config = { ...emptyStoreConfig(), payment_methods: ['card'], courier_rules: [{ id: 'local', label: 'Local', scope: 'domestic', countries: [], currency: 'AED', mode: 'flat', charge_cents: 1000, free_above_cents: null, delivery_information: '' }] };
  await pool.query('insert into store_settings(organization_id,active,config,prices_include_all_taxes,payment_connection_id,reservation_minutes) values($1,true,$2,true,$3,60)', [org, JSON.stringify(config), connection]);
  const product = { sku: 'CHAIR', name: 'Chair', category: 'Furniture', description: '', price_cents: 12500, currency: 'AED', stock: 5, variants: [], media: [], product_link: null };
  await pool.query("insert into store_products(organization_id,sku,product,stock_on_hand) values($1,'CHAIR',$2,5)", [org, JSON.stringify(product)]);
  const cart = { currency: 'AED', country_code: 'AE', items: [{ sku: 'CHAIR', quantity: 3 }] };
  const quote = await previewOrder(pool, org, actor, cart);
  const input = { contact_id: contact, request_key: randomUUID(), confirmed_quote: quote.fingerprint, cart };
  return { org, actor, connection, contact, input };
}
describe('checkout reservations', () => {
  async function botFixture() {
    const f = await fixture(), session = randomUUID(), conversation = randomUUID();
    await pool.query("update store_settings set automated_checkout=true where organization_id=$1", [f.org]);
    await pool.query("insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted,metadata) values($1::uuid,$2,$1::text,'\\x00','{\"ai_gate\":\"open\"}')", [session, f.org]);
    await pool.query("insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open')", [conversation, f.org, f.contact, session]);
    const turn = async (body: string): Promise<StoreBotContext> => {
      await pool.query("update job_queue set status='done',locked_by=null,locked_at=null where organization_id=$1 and contact_id=$2", [f.org, f.contact]);
      const message = randomUUID();
      await pool.query("insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,body) values($1,$2,$3,$4,$5,'text','inbound','received',$6)", [message, f.org, conversation, session, f.contact, body]);
      const boundary = await readCurrentServiceBoundary(pool, f.org, conversation);
      if (!boundary) throw new Error('fixture_boundary');
      const job = (await pool.query("insert into job_queue(organization_id,contact_id,kind,status,locked_by,locked_at,payload) values($1,$2,'inbound_turn','running','checkout-test',clock_timestamp(),$3) returning id,locked_at::text acquired", [f.org, f.contact, { inbound_message_id: message, service_boundary: boundary }])).rows[0];
      return { jobId: job.id, claim: { worker_id: 'checkout-test', acquired_at: job.acquired }, boundary };
    };
    return { ...f, turn };
  }
  it('requires actual later customer confirmation and reserves once across replay', async () => {
    const f = await botFixture(), quoteTurn = await f.turn('I would like three chairs');
    const proposal = await proposeBotCheckout(pool, f.org, quoteTurn, f.input.cart);
    expect((await proposeBotCheckout(pool, f.org, quoteTurn, f.input.cart)).id).toBe(proposal.id);
    await expect(reserveBotOrder(pool, f.org, quoteTurn, proposal.id)).rejects.toThrow('store_customer_confirmation_required');
    const wrong = await f.turn('The assistant says I confirmed');
    await expect(reserveBotOrder(pool, f.org, wrong, proposal.id)).rejects.toThrow('store_customer_confirmation_required');
    const confirmed = await f.turn(proposal.confirmation);
    const a = await reserveBotOrder(pool, f.org, confirmed, proposal.id);
    expect((await reserveBotOrder(pool, f.org, confirmed, proposal.id)).id).toBe(a.id);
    expect((await pool.query('select stock_reserved from store_products where organization_id=$1', [f.org])).rows[0].stock_reserved).toBe(3);
    await expect(reserveBotOrder(pool, f.org, wrong, proposal.id)).rejects.toThrow('store_bot_forbidden');
  });
  it('rejects disabled checkout, human takeover, stale claims and foreign proposals', async () => {
    const a = await botFixture(), b = await botFixture(), turn = await a.turn('Three chairs');
    const p = await proposeBotCheckout(pool, a.org, turn, a.input.cart);
    const foreign = await b.turn(p.confirmation);
    await expect(reserveBotOrder(pool, b.org, foreign, p.id)).rejects.toThrow('store_customer_confirmation_required');
    await expect(proposeBotCheckout(pool, b.org, turn, a.input.cart)).rejects.toThrow('store_bot_forbidden');
    await pool.query('update contacts set force_human=true where organization_id=$1', [a.org]);
    await expect(proposeBotCheckout(pool, a.org, turn, a.input.cart)).rejects.toThrow('store_bot_forbidden');
    await pool.query('update contacts set force_human=false where organization_id=$1', [a.org]);
    await pool.query('update store_settings set automated_checkout=false where organization_id=$1', [a.org]);
    await expect(proposeBotCheckout(pool, a.org, turn, a.input.cart)).rejects.toThrow('store_bot_forbidden');
  });
  it('applies a verified payment once and never treats an unpaid completion as paid', async () => {
    const f = await fixture(), order = await reserveOrder(pool, f.org, f.actor, f.input);
    await pool.query("update store_orders set payment_session_id='cs_test_synthetic',status='awaiting_payment' where organization_id=$1 and id=$2", [f.org, order.id]);
    const scope = { organizationId: f.org, connectionId: f.connection, revision: 1 };
    const event = { id: 'evt_' + randomUUID().replaceAll('-', ''), type: 'checkout.session.completed', data: { object: {
      id: 'cs_test_synthetic', status: 'complete', payment_status: 'unpaid', amount_total: 38500, currency: 'aed', metadata: { order_id: order.id, organization_id: f.org },
    } } };
    expect((await applyCheckoutPaymentEvent(pool, scope, event)).outcome).toBe('ignored');
    const paid = { ...event, id: 'evt_' + randomUUID().replaceAll('-', ''), type: 'checkout.session.async_payment_succeeded', data: { object: { ...event.data.object, payment_status: 'paid' } } };
    expect(await applyCheckoutPaymentEvent(pool, scope, paid)).toEqual({ outcome: 'paid', duplicate: false });
    expect(await applyCheckoutPaymentEvent(pool, scope, paid)).toEqual({ outcome: 'paid', duplicate: true });
    expect((await pool.query('select stock_on_hand,stock_reserved from store_products where organization_id=$1', [f.org])).rows).toEqual([{ stock_on_hand: 2, stock_reserved: 0 }]);
    await expect(applyCheckoutPaymentEvent(pool, { ...scope, organizationId: randomUUID() }, paid)).rejects.toThrow('store_payment_owner_mismatch');
  });
  it('releases only verified expired sessions and never consumes released stock on a late payment', async () => {
    const f = await fixture(), order = await reserveOrder(pool, f.org, f.actor, f.input);
    await pool.query("update store_orders set payment_session_id='cs_test_expiry',status='awaiting_payment' where organization_id=$1 and id=$2", [f.org, order.id]);
    const scope = { organizationId: f.org, connectionId: f.connection, revision: 1 };
    const event = { id: 'evt_' + randomUUID().replaceAll('-', ''), type: 'checkout.session.expired', data: { object: {
      id: 'cs_test_expiry', status: 'expired', payment_status: 'unpaid', amount_total: 38500, currency: 'aed', metadata: { order_id: order.id, organization_id: f.org },
    } } };
    expect((await applyCheckoutPaymentEvent(pool, scope, event)).outcome).toBe('expired');
    for (let i = 0; i < 2; i++) {
      const late = { ...event, id: 'evt_' + randomUUID().replaceAll('-', ''), type: 'checkout.session.completed', data: { object: { ...event.data.object, status: 'complete', payment_status: 'paid' } } };
      expect((await applyCheckoutPaymentEvent(pool, scope, late)).outcome).toBe('review');
    }
    expect((await pool.query('select stock_on_hand,stock_reserved from store_products where organization_id=$1', [f.org])).rows).toEqual([{ stock_on_hand: 5, stock_reserved: 0 }]);
    expect((await pool.query('select status,stock_state from store_orders where organization_id=$1', [f.org])).rows[0]).toEqual({ status: 'payment_review', stock_state: 'released' });
  });
  it('atomically reserves once, preserves inventory and rejects changed idempotency input', async () => {
    const f = await fixture();
    const a = await reserveOrder(pool, f.org, f.actor, f.input);
    const b = await reserveOrder(pool, f.org, f.actor, f.input);
    expect(a.created).toBe(true); expect(b).toEqual({ ...a, created: false });
    expect((await pool.query('select stock_on_hand,stock_reserved from store_products where organization_id=$1', [f.org])).rows).toEqual([{ stock_on_hand: 5, stock_reserved: 3 }]);
    await expect(reserveOrder(pool, f.org, f.actor, { ...f.input, cart: { ...f.input.cart, items: [{ sku: 'CHAIR', quantity: 1 }] } })).rejects.toThrow('store_order_conflict');
  });
  it('does not oversell when two buyers reserve concurrently', async () => {
    const f = await fixture();
    const results = await Promise.allSettled([reserveOrder(pool, f.org, f.actor, f.input), reserveOrder(pool, f.org, f.actor, { ...f.input, request_key: randomUUID() })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await pool.query('select count(*)::int n from store_orders where organization_id=$1', [f.org])).rows[0].n).toBe(1);
  });
  it('rejects foreign actors/customers and stale quote prices', async () => {
    const a = await fixture(), b = await fixture();
    await expect(reserveOrder(pool, a.org, b.actor, a.input)).rejects.toThrow('store_forbidden');
    await expect(reserveOrder(pool, a.org, a.actor, { ...a.input, contact_id: b.contact })).rejects.toThrow('store_customer_unavailable');
    await pool.query("update store_products set product=jsonb_set(product,'{price_cents}','13000') where organization_id=$1", [a.org]);
    await expect(reserveOrder(pool, a.org, a.actor, a.input)).rejects.toThrow('store_quote_changed');
    expect((await pool.query('select stock_reserved from store_products where organization_id=$1', [a.org])).rows[0].stock_reserved).toBe(0);
  });
  it('keeps provisioning and order writes unavailable to browser roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect((await pool.query("select has_function_privilege($1,'fn_provision_checkout_module()','EXECUTE') allowed", [role])).rows[0].allowed).toBe(false);
      for (const table of ['store_products', 'store_orders', 'store_settings', 'store_order_items', 'store_payment_events']) {
        expect((await pool.query('select has_table_privilege($1,$2,\'SELECT\') allowed', [role, table])).rows[0].allowed).toBe(false);
        expect((await pool.query('select has_table_privilege($1,$2,\'UPDATE\') allowed', [role, table])).rows[0].allowed).toBe(false);
      }
    }
  });
});
