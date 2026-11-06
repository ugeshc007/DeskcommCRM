// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reconcileStoreOrder, recoverOrderPayment } from './reconcile';
import { providerHttp } from '@/lib/integrations/provider-http';
import { loadConnection, readConnectionCredential } from '@/lib/integrations/management';
import { applyCheckoutPaymentEvent } from './payment-events';
vi.mock('@/lib/integrations/provider-http', () => ({ providerHttp: vi.fn() }));
vi.mock('@/lib/integrations/management', () => ({ loadConnection: vi.fn(), readConnectionCredential: vi.fn() }));
vi.mock('./payment-events', async load => ({ ...await load<typeof import('./payment-events')>(), applyCheckoutPaymentEvent: vi.fn() }));
const org = '11111111-1111-4111-8111-111111111111', orderId = '22222222-2222-4222-8222-222222222222', actorId = '33333333-3333-4333-8333-333333333333', connectionId = '44444444-4444-4444-8444-444444444444';
const vault = {} as SupabaseClient;
function fixture(patch: Record<string, unknown> = {}) {
  const order = { id: orderId, organization_id: org, contact_id: actorId, status: 'payment_review', stock_state: 'reserved', payment_session_id: 'cs_test_saved', connection_id: connectionId, connection_revision: 1, total_cents: 1000, currency: 'AED', expires_at: '2099-01-01', ...patch };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('select * from public.store_orders')) return { rows: [order], rowCount: 1 };
    if (sql.includes('select sku,quantity')) return { rows: [{ sku: 'SKU', quantity: 2 }], rowCount: 1 };
    return { rows: [{ id: orderId }], rowCount: 1 };
  });
  const release = vi.fn();
  return { order, query, release, pool: { connect: async () => ({ query, release }) } as unknown as Pick<pg.Pool, 'connect'> };
}
const session = { id: 'cs_test_saved', client_reference_id: orderId, amount_total: 1000, currency: 'aed', status: 'complete', payment_status: 'paid', metadata: { order_id: orderId, organization_id: org }, url: null };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadConnection).mockResolvedValue({ id: connectionId, revision: 1, provider: 'stripe', active: true, label: 'Test payments', auth_kind: 'api_key', validated_at: null, failure_code: null });
  vi.mocked(readConnectionCredential).mockResolvedValue(JSON.stringify({ token: 'sk_test_synthetic', webhook_secret: 'whsec_synthetic_fixture_only' }));
  vi.mocked(providerHttp).mockResolvedValue({ status: 200, data: session });
  vi.mocked(applyCheckoutPaymentEvent).mockResolvedValue({ outcome: 'paid', duplicate: false });
});
it('recovers known sessions by authenticated GET only and reuses verified settlement', async () => {
  const f = fixture();
  expect(await reconcileStoreOrder(f.pool, vault, org, orderId)).toBe('done');
  expect(providerHttp).toHaveBeenCalledWith('https://api.stripe.com/v1/checkout/sessions/cs_test_saved', 'GET', expect.anything());
  expect(applyCheckoutPaymentEvent).toHaveBeenCalledWith(f.pool, { organizationId: org, connectionId, revision: 1 }, expect.objectContaining({ type: 'checkout.session.completed' }));
});
it('never creates another session or releases stock after an unknown attempt', async () => {
  const f = fixture({ payment_session_id: null, expires_at: '2000-01-01' });
  await expect(reconcileStoreOrder(f.pool, vault, org, orderId)).rejects.toThrow('store_payment_unknown_review_required');
  expect(providerHttp).not.toHaveBeenCalled();
  expect(f.query.mock.calls.some(([sql]) => sql.includes('update public.store_products'))).toBe(false);
});
it('releases expired stock only when no payment attempt was started', async () => {
  const f = fixture({ status: 'reserved', payment_session_id: null, expires_at: '2000-01-01' });
  expect(await reconcileStoreOrder(f.pool, vault, org, orderId)).toBe('done');
  expect(providerHttp).not.toHaveBeenCalled();
  expect(f.query.mock.calls.some(([sql]) => sql.includes("stock_state='released'"))).toBe(true);
});
it('refuses a foreign session or changed immutable client reference during manual recovery', async () => {
  const f = fixture({ payment_session_id: null });
  vi.mocked(providerHttp).mockResolvedValue({ status: 200, data: { ...session, client_reference_id: actorId } });
  await expect(recoverOrderPayment(f.pool, vault, { organizationId: org, actorId, orderId }, session.id)).rejects.toThrow('store_payment_owner_mismatch');
  expect(f.query.mock.calls.some(([sql]) => sql.includes('update public.store_orders'))).toBe(false);
});
it('does not settle a provider amount mismatch', async () => {
  const f = fixture();
  vi.mocked(providerHttp).mockResolvedValue({ status: 200, data: { ...session, amount_total: 1 } });
  await expect(reconcileStoreOrder(f.pool, vault, org, orderId)).rejects.toThrow('store_payment_owner_mismatch');
  expect(applyCheckoutPaymentEvent).not.toHaveBeenCalled();
});
