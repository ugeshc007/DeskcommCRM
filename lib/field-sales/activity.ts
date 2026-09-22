import type pg from 'pg';
import { z } from 'zod';
import { fieldFingerprint } from './attendance';
import { fieldAudit, fieldTransaction, requireFieldEmployee, requireFieldProjectAccess } from './authority';
import { localParts } from './schedule';

/** Audio never reaches this contract; only text confirmed by the officer does. */
export const fieldActivityCommandSchema = z.strictObject({
  activity_id: z.uuid(), session_id: z.uuid(), project_id: z.uuid(),
  project_customer_id: z.uuid().nullable(),
  note: z.string().trim().min(1).max(1000), source: z.enum(['voice', 'typed']),
  captured_at: z.iso.datetime({ offset: true }),
});

export async function recordFieldActivity(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = fieldActivityCommandSchema.parse(raw), fingerprint = fieldFingerprint(input);
  return fieldTransaction(pool, org, actor, async db => {
    await requireFieldEmployee(db, org, actor);
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`field-activity:${org}:${input.activity_id}`]);
    const prior = (await db.query(`select employee_id,fingerprint from public.field_sales_activity_notes
      where organization_id=$1 and id=$2`, [org, input.activity_id])).rows[0];
    if (prior) {
      if (prior.employee_id !== actor || prior.fingerprint !== fingerprint) throw new Error('field_idempotency_conflict');
      return { activity_id: input.activity_id, replayed: true };
    }
    const at = new Date(input.captured_at), now = (await db.query('select clock_timestamp() at')).rows[0].at as Date;
    if (at.getTime() > now.getTime() + 60_000) throw new Error('field_device_clock_ahead');
    const session = (await db.query(`select punched_in_at,punched_out_at from public.field_sales_sessions
      where organization_id=$1 and id=$2 and employee_id=$3 for share`, [org, input.session_id, actor])).rows[0];
    if (!session || at < session.punched_in_at || at.getTime() >= new Date(session.punched_in_at).getTime() + 14 * 3600000 ||
      session.punched_out_at && at >= session.punched_out_at) throw new Error('field_work_session_required');
    const lastEvent = (await db.query(`select action from public.field_sales_attendance_events
      where organization_id=$1 and session_id=$2 and captured_at<=$3 order by sequence desc limit 1`,
    [org, input.session_id, input.captured_at])).rows[0];
    if (!lastEvent || !['punch_in', 'break_end', 'select_project'].includes(lastEvent.action))
      throw new Error('field_work_session_required');
    const timezone = (await db.query('select timezone from public.organizations where id=$1', [org])).rows[0].timezone as string;
    await requireFieldProjectAccess(db, org, actor, input.project_id, localParts(at.getTime(), timezone).slice(0, 10));
    if (input.project_customer_id) {
      const customer = await db.query(`select id from public.field_sales_project_customers
        where organization_id=$1 and id=$2 and project_id=$3 and active for share`,
      [org, input.project_customer_id, input.project_id]);
      if (!customer.rowCount) throw new Error('field_customer_unavailable');
    }
    await db.query(`insert into public.field_sales_activity_notes
      (organization_id,id,employee_id,session_id,project_id,project_customer_id,note,source,captured_at,fingerprint)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [org, input.activity_id, actor, input.session_id, input.project_id, input.project_customer_id,
      input.note, input.source, input.captured_at, fingerprint]);
    await fieldAudit(db, org, actor, 'field_sales.activity_recorded', input.activity_id,
      { project_id: input.project_id, customer_linked: !!input.project_customer_id });
    return { activity_id: input.activity_id, replayed: false };
  });
}
