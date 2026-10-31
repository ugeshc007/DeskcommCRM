// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { inboundPostprocessHandler } from './inbound-postprocess.handler';
import type { EventRow } from '@/lib/event-log/dispatcher';
const f = vi.hoisted(() => ({ read: vi.fn(), eq: vi.fn(), effects: vi.fn() }));
vi.mock('@/lib/channels/pos-entrada', () => ({ aplicarEfeitosPosEntrada: f.effects }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => {
  const q = { select: () => q, eq: (...args: unknown[]) => { f.eq(...args); return q; }, maybeSingle: f.read };
  return { from: () => q };
} }));
const row: EventRow = { id: '11111111-1111-4111-8111-111111111111', organization_id: '22222222-2222-4222-8222-222222222222', event_type: 'channel.inbound_postprocess', entity_kind: 'message', entity_id: '33333333-3333-4333-8333-333333333333', payload: { contact_id: 'untrusted' }, metadata: {}, consumed_by: [], attempts: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  f.read.mockResolvedValueOnce({ data: { id: row.entity_id, contact_id: 'stored-contact', conversation_id: 'stored-conversation', channel_session_id: 'stored-session', body: 'Synthetic', direction: 'inbound' }, error: null });
  f.read.mockResolvedValueOnce({ data: { is_anonymized: false }, error: null });
});
it('uses stored identities and durable effects, never payload ownership', async () => {
  expect((await inboundPostprocessHandler.handle(row)).status).toBe('ok');
  expect(f.eq).toHaveBeenCalledWith('organization_id', row.organization_id);
  expect(f.effects).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ durable: true, contactId: 'stored-contact', messageId: row.entity_id }));
});
it('returns sanitized retryable failure instead of acknowledging lost work', async () => {
  f.effects.mockRejectedValue(new Error('private token and customer data'));
  expect(await inboundPostprocessHandler.handle(row)).toEqual({ consumer_key: 'inbound_postprocess.v1', status: 'error', detail: 'inbound_postprocess_retry' });
});
it('does not retry an anonymized customer reply', async () => {
  f.read.mockReset().mockResolvedValueOnce({ data: { direction: 'inbound', contact_id: 'stored' }, error: null }).mockResolvedValueOnce({ data: { is_anonymized: true }, error: null });
  expect((await inboundPostprocessHandler.handle(row)).status).toBe('skipped');
  expect(f.effects).not.toHaveBeenCalled();
});
