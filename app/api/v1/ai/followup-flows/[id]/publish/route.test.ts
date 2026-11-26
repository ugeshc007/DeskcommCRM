import { beforeEach, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ from: vi.fn(), connection: vi.fn(), publish: vi.fn(), guard: vi.fn() }));
vi.mock('@/lib/impersonate/support', () => ({ requireSupportWrite: async () => null }));
vi.mock('@/lib/auth/require-role', () => ({ requireRole: mocks.guard }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock('@/lib/integrations/management', () => ({ loadConnection: mocks.connection }));
vi.mock('@/lib/integrations/providers', () => ({ integrationActions: [{ provider: 'webhook', action: 'send_event' }] }));
vi.mock('@/lib/followup/publish', () => ({ publishFollowupFlowVersion: mocks.publish }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));
import { POST } from './route';

const id = '33333333-3333-4333-8333-333333333333';
const connectionId = '44444444-4444-4444-8444-444444444444';
const org = '11111111-1111-4111-8111-111111111111';
const position = { x: 0, y: 0 };
const graph = {
  nodes: [
    { id: 'start', label: 'Start', type: 'trigger', position, config: {} },
    { id: 'action', label: 'Action', type: 'action', position, config: { mode: 'integration', action: 'send_event', mappings: {}, connection_id: connectionId, connection_revision: 1 } },
    { id: 'end', label: 'End', type: 'end', position, config: { outcome: 'custom' } },
  ],
  edges: [
    { id: 'entry', source: 'start', target: 'action', priority: 0, condition: { type: 'always' } },
    ...['success', 'error'].map(branch => ({ id: branch, source: 'action', target: 'end', priority: 0, condition: { type: 'branch', branch_id: branch } })),
  ],
};
function query(data: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), single: vi.fn() };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q);
  q.maybeSingle.mockResolvedValue({ data, error: null }); q.single.mockResolvedValue({ data, error: null });
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, user: { id: 'actor', idioma: 'en' }, org: { orgId: org } });
  mocks.from.mockReturnValue(query({ id, draft_graph: graph, trigger_config: { kind: 'manual' } }));
  mocks.publish.mockResolvedValue({ ok: true, version_id: 'version' });
  mocks.connection.mockResolvedValue({ id: connectionId, provider: 'webhook', active: true, revision: 1, validated_at: '2026-09-18T00:00:00Z', failure_code: null });
});
async function publish() { return POST(new Request('https://example.test/publish', { method: 'POST' }) as NextRequest, { params: Promise.resolve({ id }) }); }
it.each([
  { validated_at: null }, { failure_code: 'provider_unavailable' }, { revision: 2 }, { active: false },
])('rejects an unready connection: %j', async override => {
  mocks.connection.mockResolvedValue({ id: connectionId, provider: 'webhook', active: true, revision: 1, validated_at: '2026-09-18T00:00:00Z', failure_code: null, ...override });
  expect((await publish()).status).toBe(422);
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('loads the connection in the authenticated organization before publishing', async () => {
  expect((await publish()).status).toBe(200);
  expect(mocks.connection).toHaveBeenCalledWith(expect.anything(), org, connectionId);
  expect(mocks.publish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ orgId: org, pointerId: id }));
});
it('does not publish on an indeterminate connection lookup', async () => {
  mocks.connection.mockRejectedValue(new Error('storage unavailable'));
  expect((await publish()).status).toBe(503);
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('rejects a missing or foreign organization connection', async () => {
  mocks.connection.mockResolvedValue(null);
  expect((await publish()).status).toBe(422);
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('does not inspect connections or publish when authorization fails', async () => {
  mocks.guard.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
  expect((await publish()).status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
  expect(mocks.connection).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});
it('scopes pointer loading and the response reload to the active organization', async () => {
  const pointer = query({ id, draft_graph: graph, trigger_config: { kind: 'manual' } });
  const reload = query({ id, status: 'active', active_version_id: 'version' });
  mocks.from.mockReturnValueOnce(pointer).mockReturnValueOnce(reload);
  expect((await publish()).status).toBe(200);
  expect(pointer.eq).toHaveBeenCalledWith('organization_id', org);
  expect(reload.eq).toHaveBeenCalledWith('organization_id', org);
});
