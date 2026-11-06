// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseMessengerWebhook, verifyMessengerChallenge, verifyMessengerSignature } from './protocol';

const secret = 'synthetic-app-secret';
const page = '1234';
const event = {
  sender: { id: '5678' }, recipient: { id: page }, timestamp: 1750000000000,
  message: { mid: 'synthetic-message-1', text: 'Hello' },
};
function signed(value: unknown) {
  const raw = Buffer.from(JSON.stringify(value));
  return { raw, signature: `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` };
}
function parse(events: unknown[], entryId = page, expectedPage = page) {
  const { raw, signature } = signed({ object: 'page', entry: [{ id: entryId, messaging: events }] });
  return parseMessengerWebhook(raw, signature, secret, expectedPage);
}

describe('Messenger signed Page-scoped protocol', () => {
  it('normalizes text without turning the sender into a phone number', () => {
    expect(parse([event])).toEqual([{
      pageId: page, senderId: '5678', externalId: 'synthetic-message-1',
      timestamp: event.timestamp, text: 'Hello', selection: null, attachmentTypes: [], attachments: [],
    }]);
  });
  it('rejects the same signed event for a different Page', () => {
    expect(() => parse([event], page, '9999')).toThrow('webhook_page_mismatch');
  });
  it('checks the inner recipient as well as the entry Page', () => {
    expect(() => parse([{ ...event, recipient: { id: '9999' } }])).toThrow('webhook_page_mismatch');
  });
  it('ignores echoes and delivery receipts rather than dispatching the bot', () => {
    expect(parse([{ ...event, message: { ...event.message, is_echo: true } }, {
      sender: event.sender, recipient: event.recipient, timestamp: event.timestamp,
      delivery: { mids: ['synthetic-message-1'] },
    }])).toEqual([]);
  });
  it('uses payload identity, not a translated button title', () => {
    expect(parse([{ ...event, message: { ...event.message, quick_reply: { payload: 'buy_product' } } }])[0]?.selection).toBe('buy_product');
  });
  it('supports postbacks with stable message IDs', () => {
    const { message: _message, ...base } = event;
    expect(parse([{ ...base, postback: { mid: 'postback-1', title: 'Buy', payload: 'sku_1' } }])[0])
      .toMatchObject({ externalId: 'postback-1', text: 'Buy', selection: 'sku_1' });
  });
  it('rejects a postback without a stable deduplication identity', () => {
    const { message: _message, ...base } = event;
    expect(() => parse([{ ...base, postback: { payload: 'sku_1' } }])).toThrow('webhook_message_id_missing');
  });
  it('rejects unsafe attachment URLs before persistence or downloads', () => {
    expect(() => parse([{ ...event, message: {
      mid: 'media-1', attachments: [{ type: 'image', payload: { url: 'http://127.0.0.1/private' } }],
    } }])).toThrow();
  });
  it('preserves every supported attachment for private persistence', () => {
    const result = parse([{ ...event, message: { mid: 'media-2', attachments: [
      { type: 'image', payload: { url: 'https://cdn.example/one.png' } },
      { type: 'file', payload: { url: 'https://cdn.example/one.pdf' } },
    ] } }]);
    expect(result[0]?.attachments).toEqual([{ kind: 'image', url: 'https://cdn.example/one.png' }, { kind: 'document', url: 'https://cdn.example/one.pdf' }]);
  });
  it.each([null, '', 'sha1=abcd', 'sha256=abcd', `sha256=${'z'.repeat(64)}`])('fails closed for invalid signature %s', signature => {
    expect(verifyMessengerSignature(Buffer.from('{}'), signature, secret)).toBe(false);
  });
  it('rejects payload mutation, another app secret, and a missing app secret', () => {
    const { raw, signature } = signed({ object: 'page', entry: [] });
    expect(verifyMessengerSignature(raw, signature, secret)).toBe(true);
    expect(verifyMessengerSignature(Buffer.concat([raw, Buffer.from(' ')]), signature, secret)).toBe(false);
    expect(verifyMessengerSignature(raw, signature, 'other-secret')).toBe(false);
    expect(verifyMessengerSignature(raw, signature, '')).toBe(false);
  });
  it('verifies authentication before parsing malformed JSON', () => {
    expect(() => parseMessengerWebhook(Buffer.from('{'), null, secret, page)).toThrow('invalid_webhook_signature');
  });
  it('never includes the raw payload in parsing errors', () => {
    const { raw, signature } = signed({ sensitive: 'synthetic-sensitive-value' });
    expect(() => parseMessengerWebhook(raw, signature, secret, page)).toThrow(/^invalid_webhook_payload$/);
  });
  it('requires subscribe mode, exact verification token and numeric challenge', () => {
    expect(verifyMessengerChallenge('subscribe', 'verification', '4321', 'verification')).toBe('4321');
    expect(verifyMessengerChallenge('subscribe', 'wrong', '4321', 'verification')).toBeNull();
    expect(verifyMessengerChallenge('subscribe', '', '4321', '')).toBeNull();
    expect(verifyMessengerChallenge('unsubscribe', 'verification', '4321', 'verification')).toBeNull();
    expect(verifyMessengerChallenge('subscribe', 'verification', '<script>', 'verification')).toBeNull();
  });
});
