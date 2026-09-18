import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: vi.fn(), support: vi.fn(), install: vi.fn(), pool: vi.fn() }));
vi.mock('@/lib/auth/require-role', () => ({ requireRole: mocks.role }));
vi.mock('@/lib/impersonate/support', () => ({ requireSupportWrite: mocks.support }));
vi.mock('@/lib/agent-engine/db/request-pool', () => ({ getRequestPool: mocks.pool }));
vi.mock('@/lib/ecommerce/install', () => ({ installStoreDraft: mocks.install }));
import { POST } from './route';
const org = '11111111-1111-4111-8111-111111111111', actor = '22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  vi.clearAllMocks(); mocks.role.mockResolvedValue({ ok: true, org: { orgId: org }, user: { id: actor } });
  mocks.support.mockResolvedValue(null); mocks.pool.mockReturnValue('synthetic-pool');
  mocks.install.mockResolvedValue({ created: true, receipt: {} });
});
const request = (body = '{}') => new Request('https://synthetic.test/api/v1/ecommerce-template', { method: 'POST', body });
it('requires administrator scope before accessing the database', async () => {
  mocks.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
  expect((await POST(request())).status).toBe(403); expect(mocks.pool).not.toHaveBeenCalled();
  expect(mocks.role).toHaveBeenCalledWith('admin', expect.objectContaining({ resource: 'ecommerce_template' }));
});
it('rejects support sessions rather than bypassing membership authority', async () => {
  mocks.role.mockResolvedValue({ ok: true, org: { orgId: org }, user: { id: actor, support: {} } });
  expect((await POST(request())).status).toBe(403); expect(mocks.install).not.toHaveBeenCalled();
});
it('uses authenticated scope and returns no-store for newly installed drafts', async () => {
  const response = await POST(request());
  expect(response.status).toBe(201); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.install).toHaveBeenCalledWith('synthetic-pool', org, actor, {});
});
it('returns an existing receipt without suggesting a second installation', async () => {
  mocks.install.mockResolvedValue({ created: false, receipt: {} });
  expect((await POST(request())).status).toBe(200);
});
it('rejects malformed and oversized requests before mutation', async () => {
  expect((await POST(request('{'))).status).toBe(422);
  expect((await POST(request(JSON.stringify({ text: 'a'.repeat(70001) })))).status).toBe(422);
  expect(mocks.install).not.toHaveBeenCalled();
});
it('does not expose SQL, credentials or raw database failures', async () => {
  mocks.install.mockRejectedValue(new Error('private database token synthetic-secret'));
  const response = await POST(request()); expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('synthetic-secret');
});
it('reports collisions without suggesting overwrite', async () => {
  mocks.install.mockRejectedValue({ code: '23505', message: 'private row detail' });
  const response = await POST(request()); expect(response.status).toBe(409);
  expect(await response.text()).toContain('Nothing was overwritten');
});
