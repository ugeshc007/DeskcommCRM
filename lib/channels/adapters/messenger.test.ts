// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { messengerAdapter } from './messenger';
import { resolveBoundPage } from '../messenger/binding';
import { providerHttp } from '@/lib/integrations/provider-http';
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('../messenger/binding', () => ({ resolveBoundPage: vi.fn() }));
vi.mock('@/lib/integrations/provider-http', () => ({ providerHttp: vi.fn() }));
vi.mock('../messenger/transport', () => ({ sendMessengerEnvelope: vi.fn() }));
const scope = { organizationId: '11111111-1111-4111-8111-111111111111', sessionRef: '12345' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(providerHttp).mockResolvedValue({ status: 200, data: { id: '12345' } });
});
function binding(received: string | null) {
  vi.mocked(resolveBoundPage).mockResolvedValue({
    session: { id: '22222222-2222-4222-8222-222222222222', organization_id: scope.organizationId, integration_connection_id: '33333333-3333-4333-8333-333333333333', credential_revision: 1, provider_account_id: '12345', status: 'FAILED', webhook_path_token: 'a'.repeat(32), webhook_verified_at: null, webhook_received_at: received },
    credential: { token: 'synthetic', app_secret: 'synthetic-secret', verify_token: 'synthetic-verify', page_id: '12345', graph_version: 'v26.0' },
  });
}
it('can recheck a failed binding without weakening the send resolver', async () => {
  binding('2026-09-18T12:00:00Z');
  expect(await messengerAdapter.checkHealth!(scope)).toEqual({ reachable: true, status: 'WORKING', detail: null });
  expect(resolveBoundPage).toHaveBeenCalledWith({}, scope.organizationId, scope.sessionRef, true);
});
it('does not call a tested token a working inbound channel before a message arrives', async () => {
  binding(null);
  expect(await messengerAdapter.checkHealth!(scope)).toEqual({ reachable: true, status: 'STARTING', detail: 'page_awaiting_first_message' });
});
it('rejects a token belonging to a different Page', async () => {
  binding('2026-09-18T12:00:00Z');
  vi.mocked(providerHttp).mockResolvedValue({ status: 200, data: { id: '99999' } });
  expect(await messengerAdapter.checkHealth!(scope)).toMatchObject({ status: 'FAILED', detail: 'page_identity_mismatch' });
});
it('does not expose provider errors or use a missing binding', async () => {
  vi.mocked(resolveBoundPage).mockResolvedValue(null);
  expect(await messengerAdapter.checkHealth!(scope)).toMatchObject({ reachable: false, detail: 'page_connection_unavailable' });
  expect(providerHttp).not.toHaveBeenCalled();
});
