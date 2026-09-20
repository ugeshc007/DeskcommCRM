import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { fieldAudit, fieldTransaction, requireFieldEmployee } from './authority';

export function deviceTokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }

/** A device can act only as the enrolled employee who issued it, never as a manager. */
export async function issueFieldDevice(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, label: string) {
  z.string().trim().min(1).max(100).parse(label);
  return fieldTransaction(pool, org, actor, async db => {
    await requireFieldEmployee(db, org, actor);
    const token = 'fld_' + randomBytes(32).toString('hex');
    const row = (await db.query(`insert into public.field_sales_devices(organization_id,employee_id,label,token_hash,expires_at)
      values($1,$2,$3,$4,now()+interval '30 days') returning id,expires_at`, [org, actor, label, deviceTokenHash(token)])).rows[0];
    await fieldAudit(db, org, actor, 'field_sales.device_connected', row.id);
    return { id: row.id as string, token, expires_at: (row.expires_at as Date).toISOString() };
  });
}

export async function authenticateFieldDevice(pool: Pick<pg.Pool, 'query'>, authorization: string | null) {
  if (!authorization || !/^Bearer fld_[a-f0-9]{64}$/.test(authorization)) throw new Error('field_device_unauthorized');
  const token = authorization.slice(7);
  const row = (await pool.query(`select d.id,d.organization_id,d.employee_id from public.field_sales_devices d
    join public.field_sales_employees e on e.organization_id=d.organization_id and e.user_id=d.employee_id
    join public.user_organizations m on m.organization_id=d.organization_id and m.user_id=d.employee_id
    where d.token_hash=$1 and d.revoked_at is null and d.expires_at>now() and e.active
    and m.revoked_at is null and m.accepted_at is not null and m.role in ('agent','manager','admin')`, [deviceTokenHash(token)])).rows[0];
  if (!row) throw new Error('field_device_unauthorized');
  return { deviceId: row.id as string, org: row.organization_id as string, actor: row.employee_id as string };
}

export async function listFieldDevices(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string) {
  return fieldTransaction(pool, org, actor, async db => (await db.query(`select id,label,created_at,expires_at,revoked_at
    from public.field_sales_devices where organization_id=$1 and employee_id=$2 order by created_at desc limit 100`, [org, actor])).rows);
}

export async function revokeFieldDevice(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, id: string) {
  z.uuid().parse(id);
  return fieldTransaction(pool, org, actor, async db => {
    const row = await db.query(`update public.field_sales_devices set revoked_at=coalesce(revoked_at,now())
      where organization_id=$1 and employee_id=$2 and id=$3 returning id`, [org, actor, id]);
    if (!row.rowCount) throw new Error('field_forbidden');
    await fieldAudit(db, org, actor, 'field_sales.device_revoked', id);
    return { revoked: true };
  });
}

/** Mobile sign-out revokes exactly the authenticated device before local state is erased. */
export async function revokeCurrentFieldDevice(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, deviceId: string) {
  z.uuid().parse(deviceId);
  return fieldTransaction(pool, org, actor, async db => {
    const row = await db.query(`update public.field_sales_devices set revoked_at=coalesce(revoked_at,now())
      where organization_id=$1 and employee_id=$2 and id=$3 returning id`, [org, actor, deviceId]);
    if (!row.rowCount) throw new Error('field_device_unauthorized');
    await fieldAudit(db, org, actor, 'field_sales.device_signed_out', deviceId);
    return { signed_out: true };
  });
}
