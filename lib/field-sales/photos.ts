import { createHash } from 'node:crypto';
import type pg from 'pg';
import sharp from 'sharp';
import { z } from 'zod';
import { fieldAudit, fieldTransaction, requireFieldEmployee, requireFieldScope } from './authority';

export const photoCommandSchema = z.strictObject({
  id: z.uuid(), visit_id: z.uuid(), captured_at: z.iso.datetime({ offset: true }),
  image_base64: z.string().min(4).max(1398104).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
/** Decode and re-encode: no original EXIF/GPS, SVG, animation or embedded metadata survives. */
export async function normalizeFieldPhoto(encoded: string) {
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 1048576 || bytes.toString('base64') !== encoded) throw new Error('field_photo_invalid');
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('field_photo_invalid');
    const normalized = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    if (normalized.length > 1048576) throw new Error('field_photo_invalid');
    return normalized;
  } catch { throw new Error('field_photo_invalid'); }
}
export async function saveFieldPhoto(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = photoCommandSchema.parse(raw);
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return fieldTransaction(pool, org, actor, async db => {
    await requireFieldEmployee(db, org, actor);
    const visit = (await db.query('select employee_id from public.field_sales_visits where organization_id=$1 and id=$2 for update', [org, input.visit_id])).rows[0];
    if (!visit || visit.employee_id !== actor) throw new Error('field_forbidden');
    const old = (await db.query('select fingerprint from public.field_sales_photos where organization_id=$1 and id=$2', [org, input.id])).rows[0];
    if (old) {
      if (old.fingerprint !== fingerprint) throw new Error('field_idempotency_conflict');
      return { id: input.id, replayed: true };
    }
    if (Date.parse(input.captured_at) > Date.now() + 60000) throw new Error('field_device_clock_ahead');
    const count = (await db.query('select count(*)::int n from public.field_sales_photos where organization_id=$1 and visit_id=$2', [org, input.visit_id])).rows[0].n;
    if (count >= 20) throw new Error('field_photo_limit');
    const image = await normalizeFieldPhoto(input.image_base64);
    await db.query('insert into public.field_sales_photos(organization_id,id,visit_id,employee_id,captured_at,fingerprint,image) values($1,$2,$3,$4,$5,$6,$7)', [org, input.id, input.visit_id, actor, input.captured_at, fingerprint, image]);
    await fieldAudit(db, org, actor, 'field_sales.photo_added', input.id);
    return { id: input.id, replayed: false };
  });
}
export async function listFieldPhotos(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, visitId: string) {
  z.uuid().parse(visitId);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    const visit = (await db.query('select employee_id from public.field_sales_visits where organization_id=$1 and id=$2', [org, visitId])).rows[0];
    if (!visit) throw new Error('field_forbidden');
    await requireFieldScope(db, org, actor, role, visit.employee_id);
    return (await db.query('select id,captured_at,received_at from public.field_sales_photos where organization_id=$1 and visit_id=$2 order by received_at,id limit 20', [org, visitId])).rows;
  });
}
export async function readFieldPhoto(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, id: string) {
  z.uuid().parse(id);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    const photo = (await db.query('select employee_id,image from public.field_sales_photos where organization_id=$1 and id=$2', [org, id])).rows[0];
    if (!photo) throw new Error('field_forbidden');
    await requireFieldScope(db, org, actor, role, photo.employee_id);
    await fieldAudit(db, org, actor, 'field_sales.photo_viewed', id);
    return (photo.image as Buffer).toString('base64');
  });
}
export async function deleteFieldPhoto(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, id: string) {
  z.uuid().parse(id);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    const photo = (await db.query('select employee_id from public.field_sales_photos where organization_id=$1 and id=$2 for update', [org, id])).rows[0];
    if (!photo) throw new Error('field_forbidden');
    await requireFieldScope(db, org, actor, role, photo.employee_id);
    await db.query('delete from public.field_sales_photos where organization_id=$1 and id=$2', [org, id]);
    await fieldAudit(db, org, actor, 'field_sales.photo_deleted', id);
    return { deleted: true };
  });
}
