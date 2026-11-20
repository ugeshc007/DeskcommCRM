import { describe, expect, it } from 'vitest';
import { rasterTilePath, readRasterTile, readMapArchive, readVectorTile } from './map-tiles';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
describe('self-hosted map tile addressing', () => {
  it('serves bounded archive ranges, not whole files or arbitrary paths', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'field-archive-test-'));
    try {
      const archive = Buffer.alloc(200); archive.write('PMTiles'); archive[7] = 3;
      await writeFile(path.join(fixture, 'uae.pmtiles'), archive);
      expect((await readMapArchive(fixture, ['uae.pmtiles'], 'bytes=0-7')).bytes).toEqual(archive.subarray(0, 8));
      expect((await readMapArchive(fixture, ['uae.pmtiles'], 'bytes=190-300')).end).toBe(199);
      for (const range of [null, 'bytes=0-', 'bytes=-20', 'bytes=0-2097152', 'bytes=200-300', 'bytes=7-0', 'bytes=0-1,3-4']) {
        await expect(readMapArchive(fixture, ['uae.pmtiles'], range)).rejects.toThrow('field_range_invalid');
      }
      await expect(readMapArchive(fixture, ['..', 'uae.pmtiles'], 'bytes=0-7')).rejects.toThrow('field_tile_invalid');
      archive[7] = 2; await writeFile(path.join(fixture, 'invalid.pmtiles'), archive);
      await expect(readMapArchive(fixture, ['invalid.pmtiles'], 'bytes=0-7')).rejects.toThrow('field_tile_invalid');
    } finally { await rm(fixture, { recursive: true, force: true }); }
  });
  it('accepts bounded raster XYZ tiles with optional dataset prefixes', () => {
    expect(rasterTilePath(['uae', '4', '8', '9.webp'])).toEqual({ relative: 'uae/4/8/9.webp', mime: 'image/webp' });
  });
  it.each([
    ['../uae.pmtiles', '0', '0', '0'], ['uae.pmtiles', '23', '0', '0'],
    ['uae.pmtiles', '1', '2', '0'], ['uae.pmtiles', '1', '0', '2'],
    ['uae.pmtiles', '01', '0', '0'], ['uae.pmtiles', '0', '-1', '0'],
  ])('rejects an invalid vector archive or coordinate: %j', async (...parts) => {
    await expect(readVectorTile('C:/nonexistent', parts)).rejects.toThrow('field_tile_invalid');
  });
  it.each([['..','0','0','0.png'], ['0','1','0.png'], ['23','0','0.png'], ['1','0','2.png'], ['1','0','0.svg'], ['https:','1','0','0.png'], ['01','0','0.png']])('rejects invalid paths: %j', (...parts) => {
    expect(() => rasterTilePath(parts)).toThrow('field_tile_invalid');
  });
  it('reads only bounded raster assets and refuses a dataset junction outside the root', async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'field-map-test-'));
    const root = path.join(fixture, 'tiles'), outside = path.join(fixture, 'outside');
    try {
      await mkdir(path.join(root, '0', '0'), { recursive: true });
      await mkdir(path.join(outside, '0', '0'), { recursive: true });
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=', 'base64');
      await writeFile(path.join(root, '0', '0', '0.png'), png);
      expect((await readRasterTile(root, ['0', '0', '0.png'])).bytes).toEqual(png);
      await writeFile(path.join(root, '0', '0', '0.jpg'), '<script>not a raster</script>');
      await expect(readRasterTile(root, ['0', '0', '0.jpg'])).rejects.toThrow('field_tile_invalid');
      await writeFile(path.join(outside, '0', '0', '0.png'), png);
      await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(readRasterTile(root, ['escape', '0', '0', '0.png'])).rejects.toThrow('field_tile_invalid');
    } finally { await rm(fixture, { recursive: true, force: true }); }
  });
});
