// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { providerHttp } from '@/lib/integrations/provider-http';
import type { OutboundEnvelope } from '../types';
import { sendMessengerEnvelope, type MessengerSendConnection } from './transport';

vi.mock('@/lib/integrations/provider-http', () => ({ providerHttp: vi.fn() }));
const organizationId = '11111111-1111-4111-8111-111111111111';
const connection: MessengerSendConnection = { organizationId, pageId: '1234', token: 'synthetic-token', graphVersion: 'v26.0', active: true };
const envelope: OutboundEnvelope = { organizationId, sessionRef: '1234', to: '5678', providerConversationId: '5678', kind: 'text', body: 'Hello' };
const http = vi.mocked(providerHttp);
beforeEach(() => { vi.clearAllMocks(); http.mockResolvedValue({ status: 200, data: { recipient_id: '5678', message_id: 'synthetic-message' } }); });
describe('Messenger scoped transport', () => {
  it('resolves only this organization and Page, and keeps the token out of the URL', async () => {
    const resolve = vi.fn(async () => connection);
    expect(await sendMessengerEnvelope(envelope, resolve)).toEqual({ externalId: 'synthetic-message' });
    expect(resolve).toHaveBeenCalledWith({ organizationId, pageId: '1234' });
    expect(http).toHaveBeenCalledWith('https://graph.facebook.com/v26.0/1234/messages', 'POST',
      { Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json' },
      JSON.stringify({ recipient: { id: '5678' }, messaging_type: 'RESPONSE', message: { text: 'Hello' } }));
  });
  it.each([null, { ...connection, organizationId: '22222222-2222-4222-8222-222222222222' },
    { ...connection, pageId: '9999' }, { ...connection, active: false },
    { ...connection, graphVersion: 'v26.0/../other' }, { ...connection, token: 'token\r\nheader' },
  ])('fails closed on missing, foreign, inactive or malformed credentials', async value => {
    await expect(sendMessengerEnvelope(envelope, async () => value as MessengerSendConnection | null))
      .rejects.toMatchObject({ outcome: 'rejected', code: 'messenger_connection_unavailable' });
    expect(http).not.toHaveBeenCalled();
  });
  it('allows the canonical sink to revoke permission before any network call', async () => {
    await expect(sendMessengerEnvelope({ ...envelope, beforeSend: async () => { throw new Error('permission_revoked'); } }, async () => connection))
      .rejects.toThrow('permission_revoked');
    expect(http).not.toHaveBeenCalled();
  });
  it('never retries uncertain delivery or exposes a remote error', async () => {
    http.mockRejectedValue(new Error('sensitive remote token'));
    await expect(sendMessengerEnvelope(envelope, async () => connection))
      .rejects.toMatchObject({ outcome: 'unknown', message: 'messenger_delivery_uncertain' });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('resolves fresh credentials after the final permission guard', async () => {
    let connected = true;
    await expect(sendMessengerEnvelope({ ...envelope, beforeSend: async () => { connected = false; } }, async () => connected ? connection : null))
      .rejects.toMatchObject({ outcome: 'rejected', code: 'messenger_connection_unavailable' });
    expect(http).not.toHaveBeenCalled();
  });
  it('classifies a definitive remote rejection without exposing its payload', async () => {
    http.mockResolvedValue({ status: 403, data: { error: { message: 'sensitive remote token' } } });
    await expect(sendMessengerEnvelope(envelope, async () => connection))
      .rejects.toMatchObject({ outcome: 'rejected', message: 'messenger_send_rejected' });
  });
  it.each([{ status: 503, data: {} }, { status: 302, data: {} }, { status: 200, data: {} },
    { status: 200, data: { recipient_id: '9999', message_id: 'synthetic-message' } },
  ])('does not claim delivery for ambiguous results', async response => {
    http.mockResolvedValue(response);
    await expect(sendMessengerEnvelope(envelope, async () => connection)).rejects.toMatchObject({ outcome: 'unknown' });
    expect(http).toHaveBeenCalledTimes(1);
  });
});
