import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Bounded range reads of administrator-installed vector archives; never stream a whole country. */
export async function readMapArchive(root: string, parts: string[], range: string | null) {
  if (!root || !path.isAbsolute(root)) throw new Error('field_tiles_unavailable');
  if (parts.length !== 1 || !/^[a-z0-9][a-z0-9_-]{0,79}\.pmtiles$/.test(parts[0]!)) throw new Error('field_tile_invalid');
  const match = /^bytes=(\d{1,15})-(\d{1,15})$/.exec(range ?? '');
  if (!match) throw new Error('field_range_invalid');
  const start = Number(match[1]), requestedEnd = Number(match[2]);
  if (requestedEnd < start || requestedEnd - start + 1 > 2 * 1024 * 1024) throw new Error('field_range_invalid');
  const base = await realpath(root), resolved = await realpath(path.join(base, parts[0]!));
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('field_tile_invalid');
  const file = await open(resolved, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 127 || start >= stat.size) throw new Error('field_range_invalid');
    const header = Buffer.alloc(8);
    await file.read(header, 0, 8, 0);
    if (header.toString('ascii', 0, 7) !== 'PMTiles' || header[7] !== 3) throw new Error('field_tile_invalid');
    const end = Math.min(requestedEnd, stat.size - 1), bytes = Buffer.alloc(end - start + 1);
    if ((await file.read(bytes, 0, bytes.length, start)).bytesRead !== bytes.length) throw new Error('field_tile_invalid');
    return { bytes, start, end, size: stat.size, etag: `"${stat.size}-${Math.trunc(stat.mtimeMs)}"` };
  } finally { await file.close(); }
}

/** Only raster XYZ tiles, never arbitrary files, URLs, scripts or directory listings. */
export function rasterTilePath(parts: string[]) {
  if (parts.length < 3 || parts.length > 6 || parts.some(p => p.length > 80)) throw new Error('field_tile_invalid');
  const prefixes = parts.slice(0, -3), [z, x, leaf] = parts.slice(-3);
  if (z === undefined || x === undefined || leaf === undefined) throw new Error('field_tile_invalid');
  if (prefixes.some(p => !/^[a-z0-9_-]+$/.test(p)) || !/^(0|[1-9]\d?)$/.test(z) || !/^(0|[1-9]\d*)$/.test(x)) throw new Error('field_tile_invalid');
  const match = /^(0|[1-9]\d*)\.(png|jpg|webp)$/.exec(leaf);
  if (!match || Number(z) > 22 || Number(x) >= 2 ** Number(z) || Number(match[1]) >= 2 ** Number(z)) throw new Error('field_tile_invalid');
  return { relative: parts.join('/'), mime: match[2] === 'jpg' ? 'image/jpeg' : `image/${match[2]}` };
}
export async function readRasterTile(root: string, parts: string[]) {
  if (!root || !path.isAbsolute(root)) throw new Error('field_tiles_unavailable');
  const tile = rasterTilePath(parts), base = await realpath(root);
  const resolved = await realpath(path.join(base, tile.relative));
  const relative = path.relative(base, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('field_tile_invalid');
  const file = await open(resolved, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 12 || stat.size > 1024 * 1024) throw new Error('field_tile_invalid');
    // Fixed allocation prevents a growing/malicious file from causing an unbounded read.
    const bytes = Buffer.alloc(stat.size); const read = await file.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead !== bytes.length) throw new Error('field_tile_invalid');
    const valid = tile.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : tile.mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw new Error('field_tile_invalid');
    return { bytes, mime: tile.mime };
  } finally { await file.close(); }
}
