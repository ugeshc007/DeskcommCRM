// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { request } from 'node:https';
import { beforeEach, expect, it, vi } from 'vitest';
import { fetchPageMedia } from './media';
import { safeOutboundLookup } from '@/lib/automation/outbound-request';
import { MAX_MEDIA_BYTES } from '@/lib/messaging/media/types';

vi.mock('node:https', () => ({ request: vi.fn() }));
const http = vi.mocked(request);
beforeEach(() => vi.resetAllMocks());
function response(status = 200, mime = 'image/png', length?: number, bytes = Buffer.from('synthetic-image')) {
  http.mockImplementation((...args: unknown[]) => {
    const callback = args[2] as (r: unknown) => void;
    const req = Object.assign(new EventEmitter(), { end: () => queueMicrotask(() => {
      const stream = Object.assign(new PassThrough(), { statusCode: status, headers: { 'content-type': mime, ...(length === undefined ? {} : { 'content-length': String(length) }) } });
      callback(stream); stream.end(bytes);
    }) });
    return req as ReturnType<typeof request>;
  });
}
it('pins DNS, sends no credentials and returns bounded supported media', async () => {
  response();
  expect(await fetchPageMedia('https://cdn.example/photo.png?signature=synthetic')).toEqual({ buffer: Buffer.from('synthetic-image'), mime: 'image/png' });
  expect(http.mock.calls[0]?.[1]).toMatchObject({ lookup: safeOutboundLookup, agent: false, method: 'GET' });
  expect(http.mock.calls[0]?.[1]).not.toHaveProperty('headers');
});
it.each(['http://cdn.example/a', 'https://127.0.0.1/a', 'https://169.254.169.254/a', 'https://user:password@cdn.example/a', 'https://cdn.example:8443/a'])('rejects unsafe media URL %s before requesting', async url => {
  await expect(fetchPageMedia(url)).rejects.toThrow(); expect(http).not.toHaveBeenCalled();
});
it.each([[302, 'image/png'], [200, 'text/html'], [200, 'image/svg+xml'], [500, 'image/png']] as const)('rejects redirects, unsafe MIME and failures (%s %s)', async (status, mime) => {
  response(status, mime); await expect(fetchPageMedia('https://cdn.example/a')).rejects.toThrow('page_media_download_failed');
  expect(http).toHaveBeenCalledOnce();
});
it('rejects oversized content before reading and empty bodies', async () => {
  response(200, 'image/png', MAX_MEDIA_BYTES + 1);
  await expect(fetchPageMedia('https://cdn.example/a')).rejects.toThrow('page_media_download_failed');
  response(200, 'image/png', 0, Buffer.alloc(0));
  await expect(fetchPageMedia('https://cdn.example/a')).rejects.toThrow('page_media_download_failed');
});
