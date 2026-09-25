import type pg from 'pg';
import { z } from 'zod';
import { fieldAudit, fieldTransaction, requireFieldEmployee } from './authority';
import { localDateSchema, organizationRegion } from './contracts';
import { addCalendarDays, wallTimeToUtc } from './schedule';
import { dailyAttendance } from './attendance-report';
import { DEFAULT_ROUTE_QUALITY } from './route-quality';

export async function readAttendanceDay(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, date: string, employeeId?: string | null) {
  localDateSchema.parse(date); if (employeeId) z.uuid().parse(employeeId);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    const people = (await db.query(`select user_id,display_name,active from public.field_sales_employees
      where organization_id=$1 and ($3 in ('admin','manager') or user_id=$2) order by display_name`, [org, actor, role])).rows;
    if (employeeId && !people.some(person => person.user_id === employeeId)) throw new Error('field_forbidden');
    const visible = employeeId ? people.filter(person => person.user_id === employeeId) : people;
    const ids = visible.map(person => person.user_id);
    const region = organizationRegion((await db.query('select timezone,onboarding_state from public.organizations where id=$1', [org])).rows[0]);
    if (!region.success) throw new Error('field_region_required');
    const start = wallTimeToUtc(date, '00:00', region.data.timezone);
    const end = wallTimeToUtc(addCalendarDays(date, 1), '00:00', region.data.timezone);
    const sessions = (await db.query(`select s.id,s.employee_id,s.punched_in_at,s.punched_out_at,
      c.proposed_in as corrected_in,c.proposed_out as corrected_out
      from public.field_sales_sessions s
      left join lateral(select proposed_in,proposed_out from public.field_sales_corrections c
        where c.organization_id=s.organization_id and c.session_id=s.id and c.status='approved'
        order by reviewed_at desc,id desc limit 1)c on true
      where s.organization_id=$1 and s.employee_id=any($2::uuid[])
        and coalesce(c.proposed_in,s.punched_in_at)<$4 and coalesce(c.proposed_out,s.punched_out_at,now())>$3
      order by s.punched_in_at,s.id limit 501`, [org, ids, start, end])).rows;
    if (sessions.length > 500) throw new Error('field_operations_too_large');
    const sessionIds = sessions.map(session => session.id);
    const events = (await db.query(`select session_id,action,captured_at from public.field_sales_attendance_events
      where organization_id=$1 and session_id=any($2::uuid[]) order by captured_at,sequence`, [org, sessionIds])).rows;
    const leaves = (await db.query(`select employee_id,note from public.field_sales_leave_days
      where organization_id=$1 and employee_id=any($2::uuid[]) and local_date=$3`, [org, ids, date])).rows;
    const settings = (await db.query(`select position_accuracy_m,route_accuracy_m,plausible_speed_m_s
      from public.field_sales_settings where organization_id=$1`, [org])).rows[0];
    const quality = { positionAccuracyM: settings?.position_accuracy_m ?? DEFAULT_ROUTE_QUALITY.positionAccuracyM,
      routeAccuracyM: settings?.route_accuracy_m ?? DEFAULT_ROUTE_QUALITY.routeAccuracyM,
      plausibleSpeedMps: settings?.plausible_speed_m_s ?? DEFAULT_ROUTE_QUALITY.plausibleSpeedMps };
    // Bounded sampling is for the attendance distance estimate only. Raw fixes and the route view remain untouched.
    const points = (await db.query(`select employee_id,session_id,latitude,longitude,captured_at,accuracy_m,mock_location,quality_flags from (
      select distinct on (s.employee_id,l.session_id,date_bin('30 seconds',l.captured_at,timestamptz '2000-01-01'))
        s.employee_id,l.session_id,l.latitude,l.longitude,l.captured_at,l.accuracy_m,l.mock_location,l.quality_flags
      from public.field_sales_locations l join public.field_sales_sessions s
        on s.organization_id=l.organization_id and s.id=l.session_id
      where l.organization_id=$1 and s.employee_id=any($2::uuid[]) and l.captured_at>=$3 and l.captured_at<$4
        and l.captured_at>=s.punched_in_at and (s.punched_out_at is null or l.captured_at<s.punched_out_at)
      order by s.employee_id,l.session_id,date_bin('30 seconds',l.captured_at,timestamptz '2000-01-01'),l.accuracy_m,l.captured_at
    ) sampled order by employee_id,session_id,captured_at limit 30001`, [org, ids, start, end])).rows;
    if (points.length > 30000) throw new Error('field_operations_too_large');
    const observedAt = new Date();
    return { date, timezone: region.data.timezone, generated_at: observedAt.toISOString(), role,
      rows: dailyAttendance(date, region.data.timezone, observedAt, visible, sessions, events, leaves, points, quality) };
  });
}

const leaveCommand = z.strictObject({ operation: z.enum(['approve_leave', 'revoke_leave']),
  employee_id: z.uuid(), date: localDateSchema, note: z.string().trim().max(500).optional() });
export async function manageAttendanceLeave(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = leaveCommand.parse(raw);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    if (role !== 'manager' && role !== 'admin') throw new Error('field_forbidden');
    await requireFieldEmployee(db, org, input.employee_id);
    const region = organizationRegion((await db.query('select timezone,onboarding_state from public.organizations where id=$1', [org])).rows[0]);
    if (!region.success) throw new Error('field_region_required');
    const start = wallTimeToUtc(input.date, '00:00', region.data.timezone);
    const end = wallTimeToUtc(addCalendarDays(input.date, 1), '00:00', region.data.timezone);
    if (input.operation === 'approve_leave') {
      const work = await db.query(`select 1 from public.field_sales_sessions where organization_id=$1 and employee_id=$2
        and punched_in_at<$4 and coalesce(punched_out_at,now())>$3 limit 1`, [org, input.employee_id, start, end]);
      if (work.rowCount) throw new Error('field_leave_has_work');
      await db.query(`insert into public.field_sales_leave_days(organization_id,employee_id,local_date,note,approved_by)
        values($1,$2,$3,$4,$5) on conflict(organization_id,employee_id,local_date)
        do update set note=excluded.note,approved_by=excluded.approved_by,approved_at=now()`,
      [org, input.employee_id, input.date, input.note ?? '', actor]);
    } else {
      await db.query('delete from public.field_sales_leave_days where organization_id=$1 and employee_id=$2 and local_date=$3',
        [org, input.employee_id, input.date]);
    }
    await fieldAudit(db, org, actor, 'field_sales.' + input.operation, input.employee_id, { date: input.date });
    return { saved: true };
  });
}
