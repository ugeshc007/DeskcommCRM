import type pg from 'pg';
import { z } from 'zod';
import { fieldAudit, fieldTransaction, requireFieldEmployee, requireFieldProjectAccess, type FieldDb } from './authority';
import { fieldFingerprint } from './attendance';
import { localParts } from './schedule';

const cents = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
const customerRow = z.strictObject({
  customer_code: z.string().trim().min(1).max(100),
  shop_name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(1000),
  balance_cents: cents.nullable(),
});
export const customerManagementSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('add'), project_id: z.uuid(), customer: customerRow }),
  z.strictObject({ operation: z.literal('bulk'), project_id: z.uuid(), customers: z.array(customerRow).min(1).max(500) }),
]);
export const collectionCommandSchema = z.strictObject({
  collection_id: z.uuid(), project_customer_id: z.uuid(), project_id: z.uuid(),
  session_id: z.uuid(), captured_at: z.iso.datetime({ offset: true }),
  amount_cents: z.number().int().positive().max(1_000_000_000_000).nullable(),
});
export const collectionVoidSchema = z.strictObject({ operation: z.literal('void'),
  collection_id: z.uuid(), reason: z.string().trim().min(5).max(500) });

async function projectCurrency(db: FieldDb, org: string, project: string) {
  const row = (await db.query(`select o.currency from public.field_sales_projects p
    join public.organizations o on o.id=p.organization_id
    where p.organization_id=$1 and p.id=$2 and p.active for share of p,o`, [org, project])).rows[0];
  if (!row?.currency) throw new Error('field_project_unavailable');
  return row.currency as string;
}

export async function manageProjectCustomers(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = customerManagementSchema.parse(raw);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    if (role !== 'admin' && role !== 'manager') throw new Error('field_forbidden');
    const currency = await projectCurrency(db, org, input.project_id);
    const customers = input.operation === 'bulk' ? input.customers : [input.customer];
    for (const customer of customers) {
      await db.query(`insert into public.field_sales_project_customers
        (organization_id,id,project_id,customer_code,shop_name,address,balance_cents,currency)
        values($1,gen_random_uuid(),$2,$3,$4,$5,$6,$7)
        on conflict(organization_id,project_id,customer_code) where customer_code is not null
        do update set shop_name=excluded.shop_name,address=excluded.address,balance_cents=excluded.balance_cents,
          currency=excluded.currency,active=true,revision=field_sales_project_customers.revision+1,updated_at=now()`,
      [org, input.project_id, customer.customer_code, customer.shop_name, customer.address, customer.balance_cents, currency]);
    }
    await fieldAudit(db, org, actor, 'field_sales.customers_' + input.operation, input.project_id, { count: customers.length });
    return { saved: customers.length, currency };
  });
}

/** Manager roster reads and mobile snapshots share this organization-filtered source. */
export async function readProjectCustomers(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, projectId?: string) {
  if (projectId) z.uuid().parse(projectId);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    if (projectId && role !== 'admin' && role !== 'manager')
      await requireFieldProjectAccess(db, org, actor, projectId, localParts(Date.now(),
        (await db.query('select timezone from public.organizations where id=$1', [org])).rows[0].timezone).slice(0, 10));
    if (!projectId && role !== 'admin' && role !== 'manager') throw new Error('field_forbidden');
    const rows = (await db.query(`select c.id,c.project_id,c.customer_code,c.shop_name,c.address,
      c.balance_cents,c.currency,c.active,c.revision
      from public.field_sales_project_customers c
      where c.organization_id=$1 and ($2::uuid is null or c.project_id=$2) and c.active
      order by c.shop_name,c.id limit 2001`, [org, projectId ?? null])).rows;
    if (rows.length > 2000) throw new Error('field_customers_too_large');
    return rows;
  });
}

export async function readAssignedCustomers(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, localDate: string) {
  return fieldTransaction(pool, org, actor, async db => {
    await requireFieldEmployee(db, org, actor);
    const rows = (await db.query(`select distinct c.id,c.project_id,c.customer_code,c.shop_name,c.address,
      c.balance_cents,c.currency
      from public.field_sales_project_customers c
      join public.field_sales_projects p on p.organization_id=c.organization_id and p.id=c.project_id
      join public.field_sales_schedules s on s.organization_id=c.organization_id and s.project_id=c.project_id
      where c.organization_id=$1 and s.employee_id=$2 and c.active and p.active and s.active
        and (s.rule->>'start_date')::date <= $3::date
        and (s.rule->>'end_date' is null or (s.rule->>'end_date')::date >= $3::date)
      order by c.shop_name,c.id limit 2001`, [org, actor, localDate])).rows;
    if (rows.length > 2000) throw new Error('field_customers_too_large');
    return rows;
  });
}

export async function recordCustomerCollection(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = collectionCommandSchema.parse(raw), fingerprint = fieldFingerprint(input);
  return fieldTransaction(pool, org, actor, async db => {
    await requireFieldEmployee(db, org, actor);
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`field-collection:${org}:${input.collection_id}`]);
    const prior = (await db.query(`select fingerprint,employee_id from public.field_sales_customer_collections
      where organization_id=$1 and id=$2`, [org, input.collection_id])).rows[0];
    if (prior) {
      if (prior.employee_id !== actor || prior.fingerprint !== fingerprint) throw new Error('field_idempotency_conflict');
      return { collection_id: input.collection_id, replayed: true };
    }
    const at = new Date(input.captured_at), now = (await db.query('select clock_timestamp() at')).rows[0].at as Date;
    if (at.getTime() > now.getTime() + 60_000) throw new Error('field_device_clock_ahead');
    const session = (await db.query(`select punched_in_at,punched_out_at from public.field_sales_sessions
      where organization_id=$1 and id=$2 and employee_id=$3 for share`, [org, input.session_id, actor])).rows[0];
    if (!session || at < session.punched_in_at || at.getTime() >= new Date(session.punched_in_at).getTime() + 14 * 3600000 ||
      session.punched_out_at && at >= session.punched_out_at) throw new Error('field_work_session_required');
    const activeEvent = (await db.query(`select action from public.field_sales_attendance_events
      where organization_id=$1 and session_id=$2 and captured_at<=$3 order by sequence desc limit 1`, [org, input.session_id, input.captured_at])).rows[0];
    if (!activeEvent || !['punch_in','break_end','select_project'].includes(activeEvent.action))
      throw new Error('field_work_session_required');
    const timezone = (await db.query('select timezone from public.organizations where id=$1', [org])).rows[0].timezone as string;
    await requireFieldProjectAccess(db, org, actor, input.project_id, localParts(at.getTime(), timezone).slice(0, 10));
    const customer = (await db.query(`select id,balance_cents,currency from public.field_sales_project_customers
      where organization_id=$1 and id=$2 and project_id=$3 and active for update`,
      [org, input.project_customer_id, input.project_id])).rows[0];
    if (!customer) throw new Error('field_customer_unavailable');
    const balance = customer.balance_cents === null ? null : Number(customer.balance_cents) - (input.amount_cents ?? 0);
    if (balance !== null && (!Number.isSafeInteger(balance) || Math.abs(balance) > 1_000_000_000_000))
      throw new Error('field_amount_out_of_range');
    await db.query(`insert into public.field_sales_customer_collections
      (organization_id,id,project_customer_id,project_id,employee_id,session_id,captured_at,amount_cents,balance_after_cents,currency,fingerprint)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [org, input.collection_id, input.project_customer_id, input.project_id, actor, input.session_id,
        input.captured_at, input.amount_cents, balance, customer.currency, fingerprint]);
    if (input.amount_cents !== null) await db.query(`update public.field_sales_project_customers
      set balance_cents=$3,revision=revision+1,updated_at=now() where organization_id=$1 and id=$2`,
      [org, input.project_customer_id, balance]);
    await fieldAudit(db, org, actor, input.amount_cents === null ? 'field_sales.shop_visited' : 'field_sales.collection_recorded', input.collection_id,
      { project_id: input.project_id, customer_id: input.project_customer_id });
    return { collection_id: input.collection_id, replayed: false, balance_cents: balance };
  });
}

/** Independent correction retains the original receipt and compensates its balance effect. */
export async function voidCustomerCollection(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = collectionVoidSchema.parse(raw);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    if (role !== 'admin' && role !== 'manager') throw new Error('field_forbidden');
    const receipt = (await db.query(`select project_customer_id,employee_id,amount_cents,voided_at
      from public.field_sales_customer_collections where organization_id=$1 and id=$2 for update`,
    [org, input.collection_id])).rows[0];
    if (!receipt) throw new Error('field_customer_unavailable');
    if (receipt.employee_id === actor) throw new Error('field_forbidden');
    if (receipt.voided_at) return { collection_id: input.collection_id, replayed: true };
    const customer = (await db.query(`select balance_cents from public.field_sales_project_customers
      where organization_id=$1 and id=$2 for update`, [org, receipt.project_customer_id])).rows[0];
    if (!customer) throw new Error('field_customer_unavailable');
    if (receipt.amount_cents !== null && customer.balance_cents !== null) {
      const restored = Number(customer.balance_cents) + Number(receipt.amount_cents);
      if (!Number.isSafeInteger(restored) || Math.abs(restored) > 1_000_000_000_000)
        throw new Error('field_amount_out_of_range');
      await db.query(`update public.field_sales_project_customers
        set balance_cents=$3,revision=revision+1,updated_at=now()
        where organization_id=$1 and id=$2`, [org, receipt.project_customer_id, restored]);
    }
    await db.query(`update public.field_sales_customer_collections
      set voided_at=now(),voided_by=$3,void_reason=$4 where organization_id=$1 and id=$2`,
    [org, input.collection_id, actor, input.reason]);
    await fieldAudit(db, org, actor, 'field_sales.collection_voided', input.collection_id);
    return { collection_id: input.collection_id, replayed: false };
  });
}
