import { requireRole } from '@/lib/auth/require-role';
import { fail } from '@/lib/api/wrappers';
import { env } from '@/lib/env';
import { readRasterTile, readMapArchive, readVectorTile } from '@/lib/field-sales/map-tiles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Binary map asset endpoint, not an API JSON envelope. Never accepts a remote URL. */
export async function GET(request: Request, context: { params: Promise<{ tile: string[] }> }) {
  const auth = await requireRole('agent'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Map assets are unavailable in support sessions.', 403);
  try {
    const parts = (await context.params).tile;
    if (parts.length === 4 && parts[0]?.endsWith('.pmtiles')) {
      const bytes = await readVectorTile(env.FIELD_MAP_TILES_DIR ?? '', parts);
      return new Response(bytes, { headers: { 'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (parts.at(-1)?.endsWith('.pmtiles')) {
      const result = await readMapArchive(env.FIELD_MAP_TILES_DIR ?? '', parts, request.headers.get('range'));
      return new Response(new Uint8Array(result.bytes), { status: 206, headers: {
        'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${result.start}-${result.end}/${result.size}`,
        'Content-Length': String(result.bytes.length), 'Accept-Ranges': 'bytes', ETag: result.etag,
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    const { bytes, mime } = await readRasterTile(env.FIELD_MAP_TILES_DIR ?? '', parts);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return fail('not_found', 'The local map tile is unavailable. Ask your administrator to check map coverage.', 404, { headers: { 'Cache-Control': 'private, no-store' } }); }
}
