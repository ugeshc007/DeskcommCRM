import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { safeOutboundLookup, postOutboundWebhook } from './outbound-request';
vi.mock('node:dns/promises', () => { const lookup = vi.fn(); return { lookup, default: { lookup } }; });

function resolveSocket(all = false): Promise<unknown> {
  return new Promise((resolve, reject) => safeOutboundLookup('example.com', { all }, (error, addresses) => error ? reject(error) : resolve(addresses)));
}
describe('socket-level outbound address validation', () => {
  beforeEach(() => vi.resetAllMocks());
  it('passes the exact approved lookup result to the socket, without a second resolution', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as never);
    expect(await resolveSocket()).toBe('93.184.216.34'); expect(lookup).toHaveBeenCalledTimes(1);
  });
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1'])('rejects mixed public/private DNS (%s)', async address => {
    vi.mocked(lookup).mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }] as never);
    await expect(resolveSocket(true)).rejects.toThrow('unsafe_url:private_ip');
  });
  it('fails closed on lookup failure', async () => {
    vi.mocked(lookup).mockRejectedValueOnce(new Error('secret diagnostic'));
    await expect(resolveSocket()).rejects.toThrow('unsafe_url:dns_failed');
  });
  it('rejects oversized bodies and URL-embedded credentials without connecting', async () => {
    await expect(postOutboundWebhook('https://user:secret@example.com', '{}', {})).rejects.toThrow('unsafe_url:credentials');
    await expect(postOutboundWebhook('https://example.com', 'x'.repeat(262145), {})).rejects.toThrow('webhook_payload_too_large');
    expect(lookup).not.toHaveBeenCalled();
  });
});
