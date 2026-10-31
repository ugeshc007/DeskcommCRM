// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { OutboundEnvelope } from '../types';
import { messengerOutboundPayload } from './outbound';

const envelope: OutboundEnvelope = {
  organizationId: 'synthetic-org', sessionRef: '1234', to: '5678',
  providerConversationId: '5678', kind: 'text', body: 'Hello',
};
describe('Messenger outbound translation', () => {
  it('addresses the Page-scoped conversation using RESPONSE, never phone addressing or tags', () => {
    expect(messengerOutboundPayload(envelope)).toEqual({
      recipient: { id: '5678' }, messaging_type: 'RESPONSE', message: { text: 'Hello' },
    });
  });
  it.each(['image', 'video', 'audio', 'document'] as const)('translates %s without making attachments reusable across recipients', kind => {
    expect(messengerOutboundPayload({ ...envelope, body: undefined, kind, media: { url: 'https://example.com/media', mime: 'application/octet-stream' } })).toMatchObject({
      message: { attachment: { type: kind === 'document' ? 'file' : kind, payload: { is_reusable: false } } },
    });
  });
  it('does not guess a PSID from a phone or send to a different conversation', () => {
    expect(() => messengerOutboundPayload({ ...envelope, to: '+9710000000' })).toThrow('messenger_address_invalid');
    expect(() => messengerOutboundPayload({ ...envelope, providerConversationId: null })).toThrow('messenger_thread_mismatch');
    expect(() => messengerOutboundPayload({ ...envelope, providerConversationId: '9999' })).toThrow('messenger_thread_mismatch');
  });
  it.each(['sticker', 'location', 'contact', 'template'] as const)('does not silently downgrade unsupported %s', kind => {
    expect(() => messengerOutboundPayload({ ...envelope, kind })).toThrow('messenger_message_unsupported');
  });
  it('does not silently remove interactive options or quoted-message context', () => {
    expect(() => messengerOutboundPayload({ ...envelope, interactive: { kind: 'buttons', choices: [{ id: 'yes', title: 'Yes' }] } })).toThrow('messenger_message_unsupported');
    expect(() => messengerOutboundPayload({ ...envelope, replyToExternalId: 'message-1' })).toThrow('messenger_message_unsupported');
  });
  it('does not discard captions or split one message into two untracked sends', () => {
    expect(() => messengerOutboundPayload({ ...envelope, kind: 'image', media: { url: 'https://example.com/media', mime: 'image/jpeg' } })).toThrow('messenger_caption_unsupported');
  });
  it.each(['http://example.com/media', 'https://127.0.0.1/media', 'https://user:password@example.com/media'])('rejects unsafe media destination', url => {
    expect(() => messengerOutboundPayload({ ...envelope, kind: 'image', body: undefined, media: { url, mime: 'image/jpeg' } })).toThrow();
  });
});
