import { beforeEach, expect, it, vi } from 'vitest';
import type * as OrdersModule from '@/lib/ecommerce/orders';
const m = vi.hoisted(() => ({ role: vi.fn(), support: vi.fn(), pool: vi.fn(), preview: vi.fn(), reserve: vi.fn(), payment: vi.fn(), recover: vi.fn() }));
vi.mock('@/lib/auth/require-role', () => ({ requireRole: m.role }));
vi.mock('@/lib/impersonate/support', () => ({ requireSupportWrite: m.support }));
vi.mock('@/lib/agent-engine/db/request-pool', () => ({ getRequestPool: m.pool }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => 'synthetic-vault' }));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://crm.example' } }));
vi.mock('@/lib/ecommerce/order-payment', () => ({ startOrderPayment: m.payment }));
vi.mock('@/lib/ecommerce/reconcile', () => ({ recoverOrderPayment: m.recover }));
vi.mock('@/lib/ecommerce/orders', async importOriginal => ({ ...await importOriginal<typeof OrdersModule>(), previewOrder: m.preview, reserveOrder: m.reserve }));
import { POST } from './route';
const org = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222', order = '33333333-3333-4333-8333-333333333333';
const req = (body: unknown) => new Request('https://crm.example/api/v1/ecommerce-checkout', { method: 'POST', body: JSON.stringify(body) });
it('binds recovery to the signed-in administrator and never accepts a client paid flag', async () => {
  m.recover.mockResolvedValue({ status: 'pending' });
  expect((await POST(req({ operation: 'recover', order_id: order, session_id: 'cs_test_existing' }))).status).toBe(200);
  expect(m.recover).toHaveBeenCalledWith('synthetic-pool', 'synthetic-vault', { organizationId: org, actorId: actor, orderId: order }, 'cs_test_existing');
  expect((await POST(req({ operation: 'recover', order_id: order, session_id: 'cs_test_existing', paid: true }))).status).toBe(422);
});
beforeEach(() => {
  vi.clearAllMocks(); m.role.mockResolvedValue({ ok: true, org: { orgId: org }, user: { id: actor } });
  m.support.mockResolvedValue(null); m.pool.mockReturnValue('synthetic-pool');
  m.payment.mockResolvedValue({ status: 'awaiting_payment', payment_url: 'https://checkout.stripe.com/c/pay/synthetic' });
});
it('uses authenticated authority and a server-owned return URL', async () => {
  const response = await POST(req({ operation: 'payment', order_id: order }));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(m.payment).toHaveBeenCalledWith('synthetic-pool', 'synthetic-vault', { organizationId: org, actorId: actor, orderId: order, returnUrl: 'https://crm.example/checkout/return' });
});
it('rejects injected organization and redirect fields', async () => {
  expect((await POST(req({ operation: 'payment', order_id: order, organization_id: org, return_url: 'https://attacker.example' }))).status).toBe(422);
  expect(m.payment).not.toHaveBeenCalled();
});
it('does not access the database when administrator authorization fails', async () => {
  m.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
  expect((await POST(req({ operation: 'payment', order_id: order }))).status).toBe(403);
  expect(m.pool).not.toHaveBeenCalled(); expect(m.role).toHaveBeenCalledWith('admin');
});
it('rejects support impersonation before payment actions', async () => {
  m.role.mockResolvedValue({ ok: true, org: { orgId: org }, user: { id: actor, support: {} } });
  expect((await POST(req({ operation: 'payment', order_id: order }))).status).toBe(403);
  expect(m.payment).not.toHaveBeenCalled();
});
it('rejects oversized payloads as input errors, not server failures', async () => {
  expect((await POST(req({ field: 'x'.repeat(70001) }))).status).toBe(422);
  expect(m.pool).not.toHaveBeenCalled();
});
it('reports uncertain payments without leaking provider response details', async () => {
  m.payment.mockRejectedValue(new Error('store_payment_uncertain'));
  const response = await POST(req({ operation: 'payment', order_id: order }));
  expect(response.status).toBe(409); expect(await response.text()).toContain('same order');
  m.payment.mockRejectedValue(new Error('private synthetic secret'));
  const failed = await POST(req({ operation: 'payment', order_id: order }));
  expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('synthetic secret');
});
