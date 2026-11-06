// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: vi.fn(), support: vi.fn(), manage: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/auth/require-role', () => ({ requireRole: mocks.role }));
vi.mock('@/lib/impersonate/support', () => ({ requireSupportWrite: mocks.support }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ synthetic: true }) }));
vi.mock('@/lib/integrations/management', () => ({ manageConnection: mocks.manage }));
vi.mock('@/lib/audit', () => ({ audit: mocks.audit }));
import { POST } from './route';

const org = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const credential = { page_id: '1234', token: 'synthetic-page-token', app_secret: 'a'.repeat(32), verify_token: 'synthetic_verify_token', graph_version: 'v26.0' };
const body = { provider: 'messenger', label: 'Synthetic Page', credential };
const request = (value: unknown) => new Request('https://synthetic.test/api/v1/integration-connections', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': id }, body: JSON.stringify(value),
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.support.mockResolvedValue(null);
  mocks.role.mockResolvedValue({ ok: true, user: { id: actor }, org: { orgId: org, role: 'admin' } });
  mocks.manage.mockResolvedValue({ id, provider: 'messenger', label: 'Synthetic Page', revision: 1, active: false, auth_kind: 'api_key', validated_at: null, failure_code: null });
});
describe('Page credentials through the shared connection API', () => {
  it('uses authenticated organization authority and returns metadata, never credentials', async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(201);
    expect(mocks.role).toHaveBeenCalledWith('admin');
    expect(mocks.manage).toHaveBeenCalledWith(expect.anything(), actor, org,
      { id, revision: 0, provider: 'messenger', label: 'Synthetic Page', auth_kind: 'api_key' }, 'save', JSON.stringify(credential));
    const output = await response.text();
    expect(output).not.toContain(credential.token);
    expect(output).not.toContain(credential.app_secret);
    expect(output).not.toContain(credential.verify_token);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ organizationId: org, actorUserId: actor, resourceId: id }));
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(credential.token);
  });
  it('rejects client-supplied organization authority', async () => {
    expect((await POST(request({ ...body, organization_id: org }))).status).toBe(422);
    expect(mocks.manage).not.toHaveBeenCalled();
  });
  it('rejects incomplete credentials before any write or audit', async () => {
    expect((await POST(request({ ...body, credential: { ...credential, app_secret: '' } }))).status).toBe(422);
    expect(mocks.manage).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('does not reach storage for a denied role or support-write denial', async () => {
    mocks.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request(body))).status).toBe(403);
    expect(mocks.manage).not.toHaveBeenCalled();
    mocks.support.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await POST(request(body))).status).toBe(403);
    expect(mocks.manage).not.toHaveBeenCalled();
  });
});
