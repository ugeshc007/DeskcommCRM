import type pg from 'pg';
import { z } from 'zod';
import { AsyncLocalStorage } from 'node:async_hooks';

const deviceScope = new AsyncLocalStorage<{ deviceId: string; org: string; actor: string }>();
/** Scope originates only from a verified device token, never from a request body. */
export function withFieldDevice<T>(identity: { deviceId: string; org: string; actor: string }, operation: () => Promise<T>) {
  return deviceScope.run(identity, operation);
}

export type FieldDb = Pick<pg.PoolClient, 'query'>;
export type FieldRole = 'agent' | 'manager' | 'admin';

/** No platform/support bypass: location access requires current organization membership. */
export async function fieldRole(db: FieldDb, org: string, actor: string): Promise<FieldRole> {
  z.uuid().parse(org); z.uuid().parse(actor);
  const row = (await db.query(`select role from public.user_organizations
    where organization_id=$1 and user_id=$2 and accepted_at is not null and revoked_at is null
    and role in ('agent','manager','admin') for share`, [org, actor])).rows[0];
  if (!row) throw new Error('field_forbidden');
  return row.role as FieldRole;
}

export async function requireFieldEmployee(db: FieldDb, org: string, employee: string) {
  const row = await db.query(`select e.user_id from public.field_sales_employees e
    join public.user_organizations m on m.organization_id=e.organization_id and m.user_id=e.user_id
    where e.organization_id=$1 and e.user_id=$2 and e.active and m.revoked_at is null
    and m.accepted_at is not null and m.role in ('agent','manager','admin') for share of e,m`, [org, employee]);
  if (!row.rowCount) throw new Error('field_employee_unavailable');
}

export async function requireFieldScope(db: FieldDb, org: string, actor: string, role: FieldRole, employee: string, write = false) {
  // A manager's device key is still an employee-only credential, never a management token.
  if (deviceScope.getStore() && actor !== employee) throw new Error('field_forbidden');
  if (actor === employee && !write) return;
  if (role === 'admin') return;
  if (role === 'manager') {
    const grant = await db.query(`select employee_id from public.field_sales_manager_scope
      where organization_id=$1 and manager_id=$2 and employee_id=$3 for share`, [org, actor, employee]);
    if (grant.rowCount) return;
  }
  throw new Error('field_forbidden');
}

export async function fieldTransaction<T>(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string,
  operation: (db: pg.PoolClient, role: FieldRole) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("set local lock_timeout='5s'");
    await db.query("set local statement_timeout='15s'");
    const role = await fieldRole(db, org, actor);
    const device = deviceScope.getStore();
    if (device) {
      if (device.org !== org || device.actor !== actor) throw new Error('field_device_unauthorized');
      // Serialize revocation against the actual read/write, not just preliminary authentication.
      const active = await db.query(`select id from public.field_sales_devices
        where organization_id=$1 and employee_id=$2 and id=$3
        and revoked_at is null and expires_at>clock_timestamp() for share`, [org, actor, device.deviceId]);
      if (!active.rowCount) throw new Error('field_device_unauthorized');
    }
    const result = await operation(db, role);
    await db.query('commit'); return result;
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}

export async function fieldAudit(db: FieldDb, org: string, actor: string, action: string, resource_id: string,
  metadata: Record<string, string | number | boolean> = {}) {
  await db.query(`insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id,metadata,bypassed_rls)
    values($1,$2,$3,'field_sales',$4,$5::jsonb,true)`, [org, actor, action, resource_id, JSON.stringify(metadata)]);
}
