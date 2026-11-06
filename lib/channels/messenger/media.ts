import { request } from 'node:https';
import { safeOutboundLookup } from '@/lib/automation/outbound-request';
import { assertSafeOutboundUrl } from '@/lib/automation/outbound-url';
import { MAX_MEDIA_BYTES, type FetchedMedia } from '@/lib/messaging/media/types';

export function assertPageMediaUrl(raw: string): URL {
  assertSafeOutboundUrl(raw);
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new Error('page_media_url_invalid');
  return url;
}
const allowedMime = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|3gpp)|audio\/(ogg|mpeg|mp4|aac|amr|webm|wav)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-(excel|powerpoint))|text\/(plain|csv))$/;

/** URL assinada do anexo, sem token do tenant. DNS fixado e sem redirects. */
export async function fetchPageMedia(raw: string): Promise<FetchedMedia> {
  const url = assertPageMediaUrl(raw);
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error('page_media_download_failed'));
    const req = request(url, { method: 'GET', agent: false, lookup: safeOutboundLookup, signal: AbortSignal.timeout(30000) }, res => {
      const mime = (res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (res.statusCode !== 200 || !allowedMime.test(mime) || Number(res.headers['content-length'] ?? 0) > MAX_MEDIA_BYTES) { res.destroy(); fail(); return; }
      let size = 0;
      const parts: Buffer[] = [];
      res.on('data', (part: Buffer) => {
        size += part.length;
        if (size > MAX_MEDIA_BYTES) { res.destroy(); fail(); } else parts.push(part);
      });
      res.on('error', fail);
      res.on('end', () => size ? resolve({ buffer: Buffer.concat(parts), mime }) : fail());
    });
    req.on('error', fail); req.end();
  });
}
