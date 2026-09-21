import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { fieldAudit, fieldTransaction, requireFieldEmployee, type FieldDb } from './authority';

export function deviceTokenHash(token: string) { return createHash('sha256').update(token).digest('hex'); }

export function pairingCodeHash(code: string) {
  if (!/^\d{6}$/.test(code)) throw new Error('field_pairing_invalid');
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) throw new Error('field_pairing_unavailable');
  return createHmac('sha256', secret).update('field-sales-pairing:v1:').update(code).digest('hex');
}

async function issuePendingDevice(db: FieldDb, org: string, employee: string, label: string) {
  // Only security metadata belonging to this organization is pruned here.
  await db.query(`update public.field_sales_devices set pairing_code_hash=null,pairing_expires_at=null
    where organization_id=$1 and token_hash is null and pairing_expires_at<=now()`, [org]);
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const row = (await db.query(`insert into public.field_sales_devices
      (organization_id,employee_id,label,token_hash,pairing_code_hash,pairing_expires_at,expires_at)
      values($1,$2,$3,null,$4,now()+interval '5 minutes',now()+interval '5 minutes')
      on conflict do nothing returning id,expires_at`, [org, employee, label, pairingCodeHash(code)])).rows[0];
    if (row) return { id: row.id as string, code, expires_at: (row.expires_at as Date).toISOString() };
  }
  throw new Error('field_pairing_unavailable');
}

/** A device can act only as the enrolled employee who issued it, never as a manager. */
export async function issueFieldDevice(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, label: string) {
  z.string().trim().min(1).max(100).parse(label);
  return fieldTransaction(pool, org, actor, async db => {
    await requireFieldEmployee(db, org, actor);
    const issued = await issuePendingDevice(db, org, actor, label);
    await fieldAudit(db, org, actor, 'field_sales.device_pairing_issued', issued.id);
    return issued;
  });
}

/** Admin enrollment + employee-bound key. The plaintext is returned once only. */
export async function issueOfficerDevice(pool: Pick<pg.Pool, 'connect'>, org: string, admin: string,
  employee: string, displayName: string, label: string) {
  z.uuid().parse(employee);
  z.string().trim().min(1).max(160).parse(displayName);
  z.string().trim().min(1).max(100).parse(label);
  return fieldTransaction(pool, org, admin, async (db, role) => {
    if (role !== 'admin') throw new Error('field_forbidden');
    const member = await db.query(`select user_id from public.user_organizations where organization_id=$1
      and user_id=$2 and role='field_officer' and accepted_at is not null and revoked_at is null for share`, [org, employee]);
    if (!member.rowCount) throw new Error('field_employee_unavailable');
    await db.query(`insert into public.field_sales_employees(organization_id,user_id,display_name,active)
      values($1,$2,$3,true) on conflict(organization_id,user_id)
      do update set active=true,display_name=excluded.display_name`, [org, employee, displayName]);
    const issued = await issuePendingDevice(db, org, employee, label);
    await fieldAudit(db, org, admin, 'field_sales.device_pairing_issued', issued.id, { employee_id: employee });
    return issued;
  });
}

/** Public one-time exchange. The code is never a bearer credential. */
export async function redeemFieldPairingCode(pool: Pick<pg.Pool, 'connect'>, code: string) {
  const hash = pairingCodeHash(code);
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("set local lock_timeout='5s'");
    await db.query("set local statement_timeout='15s'");
    const row = (await db.query(`select d.id,d.organization_id,d.employee_id from public.field_sales_devices d
      join public.field_sales_employees e on e.organization_id=d.organization_id and e.user_id=d.employee_id
      join public.user_organizations m on m.organization_id=d.organization_id and m.user_id=d.employee_id
      where d.pairing_code_hash=$1 and d.pairing_expires_at>now() and d.expires_at>now() and d.revoked_at is null
        and d.token_hash is null and e.active and m.accepted_at is not null and m.revoked_at is null
        and m.role in ('field_officer','agent','manager','admin') for update of d`, [hash])).rows[0];
    if (!row) throw new Error('field_pairing_invalid');
    const token = 'fld_' + randomBytes(32).toString('hex');
    await db.query(`update public.field_sales_devices set token_hash=$1,pairing_code_hash=null,
      pairing_expires_at=null,expires_at=now()+interval '30 days'
      where organization_id=$2 and id=$3`, [deviceTokenHash(token), row.organization_id, row.id]);
    await fieldAudit(db, row.organization_id, row.employee_id, 'field_sales.device_connected', row.id);
    await db.query('commit');
    return { token, device_id: row.id as string, expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() };
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}

export async function officerDevices(pool: Pick<pg.Pool, 'connect'>, org: string, admin: string, employee: string) {
  z.uuid().parse(employee);
  return fieldTransaction(pool, org, admin, async (db, role) => {
    if (role !== 'admin') throw new Error('field_forbidden');
    const member = await db.query(`select user_id from public.user_organizations where organization_id=$1
      and user_id=$2 and role='field_officer' and accepted_at is not null and revoked_at is null for share`, [org, employee]);
    if (!member.rowCount) throw new Error('field_employee_unavailable');
    return (await db.query(`select id,label,created_at,expires_at,revoked_at,
      (token_hash is not null) as paired from public.field_sales_devices
      where organization_id=$1 and employee_id=$2 order by created_at desc limit 100`, [org, employee])).rows;
  });
}

export async function revokeOfficerDevice(pool: Pick<pg.Pool, 'connect'>, org: string, admin: string, employee: string, id: string) {
  z.uuid().parse(employee); z.uuid().parse(id);
  return fieldTransaction(pool, org, admin, async (db, role) => {
    if (role !== 'admin') throw new Error('field_forbidden');
    const row = await db.query(`update public.field_sales_devices set revoked_at=coalesce(revoked_at,now())
      where organization_id=$1 and employee_id=$2 and id=$3 returning id`, [org, employee, id]);
    if (!row.rowCount) throw new Error('field_forbidden');
    await fieldAudit(db, org, admin, 'field_sales.device_revoked', id, { employee_id: employee });
    return { revoked: true };
  });
}

export async function authenticateFieldDevice(pool: Pick<pg.Pool, 'query'>, authorization: string | null) {
  if (!authorization || !/^Bearer fld_[a-f0-9]{64}$/.test(authorization)) throw new Error('field_device_unauthorized');
  const token = authorization.slice(7);
  const row = (await pool.query(`select d.id,d.organization_id,d.employee_id from public.field_sales_devices d
    join public.field_sales_employees e on e.organization_id=d.organization_id and e.user_id=d.employee_id
    join public.user_organizations m on m.organization_id=d.organization_id and m.user_id=d.employee_id
    where d.token_hash=$1 and d.revoked_at is null and d.expires_at>now() and e.active
    and m.revoked_at is null and m.accepted_at is not null and m.role in ('field_officer','agent','manager','admin')`, [deviceTokenHash(token)])).rows[0];
  if (!row) throw new Error('field_device_unauthorized');
  return { deviceId: row.id as string, org: row.organization_id as string, actor: row.employee_id as string };
}

export async function listFieldDevices(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string) {
  return fieldTransaction(pool, org, actor, async db => (await db.query(`select id,label,created_at,expires_at,revoked_at,
    (token_hash is not null) as paired
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
