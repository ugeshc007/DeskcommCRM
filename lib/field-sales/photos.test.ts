import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { normalizeFieldPhoto } from './photos';
import { readFieldJson } from './request';

describe('private visit images', () => {
  it('re-encodes and strips metadata', async () => {
    const image = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#00aabb' } }).jpeg().withMetadata().toBuffer();
    expect((await sharp(image).metadata()).exif).toBeDefined();
    const result = await normalizeFieldPhoto(image.toString('base64'));
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe('jpeg'); expect(metadata.exif).toBeUndefined();
  });
  it('rejects SVG, non-image and oversized data', async () => {
    for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), Buffer.from('not an image'), Buffer.alloc(1048577)])
      await expect(normalizeFieldPhoto(bytes.toString('base64'))).rejects.toThrow('field_photo_invalid');
  });
  it('bounds request streams before parsing, independent of Content-Length', async () => {
    await expect(readFieldJson(new Request('https://synthetic.test', { method: 'POST', body: 'x'.repeat(1450001) }))).rejects.toThrow('invalid_request');
    await expect(readFieldJson(new Request('https://synthetic.test', { method: 'POST', body: '{"operation":"photo"}' }))).resolves.toEqual({ operation: 'photo' });
  });
});
