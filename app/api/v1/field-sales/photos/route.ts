import { ok, fail } from '@/lib/api/wrappers';
import { requireRole } from '@/lib/auth/require-role';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { listFieldPhotos, readFieldPhoto, deleteFieldPhoto } from '@/lib/field-sales/photos';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { fieldError } from '../_shared';

export async function GET(req: Request) {
  const auth = await requireRole('field_officer'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Employee photos are unavailable in support sessions.', 403);
  try {
    const query = new URL(req.url).searchParams, pool = getRequestPool();
    const data = query.has('id') ? { image_base64: await readFieldPhoto(pool, auth.org.orgId, auth.user.id, query.get('id') ?? '') }
      : { photos: await listFieldPhotos(pool, auth.org.orgId, auth.user.id, query.get('visit_id') ?? '') };
    return ok(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return fieldError(error); }
}
export async function DELETE(req: Request) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('field_officer'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use your own account for employee photos.', 403);
  try {
    return ok(await deleteFieldPhoto(getRequestPool(), auth.org.orgId, auth.user.id, new URL(req.url).searchParams.get('id') ?? ''), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return fieldError(error); }
}
