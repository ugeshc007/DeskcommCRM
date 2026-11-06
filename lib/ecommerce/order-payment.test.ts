// @vitest-environment node
import type pg from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { startOrderPayment } from './order-payment';
import { loadConnection } from '@/lib/integrations/management';
import { createStripeCheckout } from './stripe-checkout';

vi.mock('@/lib/integrations/management', () => ({ loadConnection: vi.fn(), readConnectionCredential: vi.fn() }));
vi.mock('./stripe-checkout', () => ({ createStripeCheckout: vi.fn() }));
const scope = { organizationId: '11111111-1111-4111-8111-111111111111', actorId: '22222222-2222-4222-8222-222222222222', orderId: '33333333-3333-4333-8333-333333333333', returnUrl: 'https://crm.example/checkout/return' };
const vault = {} as SupabaseClient;
function fixture(options: { active?: boolean; expires?: string; status?: string; stock?: string; member?: boolean } = {}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('pg_try_advisory_lock')) return { rowCount: 1, rows: [{ acquired: true }] };
    if (sql.includes('user_organizations')) return { rowCount: options.member === false ? 0 : 1, rows: [] };
    if (sql.includes('public.contacts')) return { rowCount: 1, rows: [] };
    if (sql.includes('select * from public.store_orders')) {
      expect(params).toEqual([scope.organizationId, scope.orderId]);
      return { rowCount: 1, rows: [{ id: scope.orderId, status: options.status ?? 'awaiting_payment', stock_state: options.stock ?? 'reserved', payment_url: 'https://checkout.stripe.com/c/pay/synthetic', payment_session_id: 'cs_test_synthetic', connection_id: '44444444-4444-4444-8444-444444444444', connection_revision: 7, expires_at: options.expires ?? '2099-01-01T00:00:00Z' }] };
    }
    if (sql.includes('integration_connections')) {
      expect(params).toEqual([scope.organizationId, '44444444-4444-4444-8444-444444444444', 7]);
      return { rowCount: options.active === false ? 0 : 1, rows: [] };
    }
    return { rowCount: 0, rows: [] };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pick<pg.Pool, 'connect'>;
  return { pool, query, release };
}
beforeEach(() => vi.clearAllMocks());
it('does not return a payable link for a disconnected or rotated connection', async () => {
  const f = fixture({ active: false });
  await expect(startOrderPayment(f.pool, vault, scope)).rejects.toThrow('store_payment_connection_unavailable');
  expect(createStripeCheckout).not.toHaveBeenCalled();
  expect(loadConnection).not.toHaveBeenCalled();
  expect(f.query).toHaveBeenCalledWith('rollback');
  expect(f.release).toHaveBeenCalledOnce();
});
it('does not reissue an expired order or release uncertain stock locally', async () => {
  const f = fixture({ expires: '2000-01-01T00:00:00Z', status: 'payment_review' });
  await expect(startOrderPayment(f.pool, vault, scope)).rejects.toThrow('store_payment_reconciliation_required');
  expect(createStripeCheckout).not.toHaveBeenCalled();
  expect(f.query.mock.calls.some(([sql]) => sql.includes('update public.store_'))).toBe(false);
});
it('returns an existing current link without a second provider action', async () => {
  const f = fixture();
  await expect(startOrderPayment(f.pool, vault, scope)).resolves.toEqual({ status: 'awaiting_payment', payment_url: 'https://checkout.stripe.com/c/pay/synthetic' });
  expect(createStripeCheckout).not.toHaveBeenCalled();
  expect(f.query).toHaveBeenCalledWith('commit');
});
it('does not present a link when stock has already been released', async () => {
  const f = fixture({ stock: 'released' });
  await expect(startOrderPayment(f.pool, vault, scope)).rejects.toThrow('store_payment_reconciliation_required');
});
it('checks current membership even for an existing order', async () => {
  const f = fixture({ member: false });
  await expect(startOrderPayment(f.pool, vault, scope)).rejects.toThrow('store_forbidden');
  expect(f.query.mock.calls.some(([sql]) => sql.includes('select * from public.store_orders'))).toBe(false);
});
