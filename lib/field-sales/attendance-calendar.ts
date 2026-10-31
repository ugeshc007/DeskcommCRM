import type pg from 'pg';
import { z } from 'zod';
import { fieldAudit, fieldTransaction, requireFieldEmployee, requireFieldScope } from './authority';
import { localDateSchema, organizationRegion } from './contracts';
import { addCalendarDays, localParts, wallTimeToUtc } from './schedule';
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
    const overdue = role === 'manager' || role === 'admin' ? (await db.query(`select s.id as session_id,s.employee_id,e.display_name,s.punched_in_at
      from public.field_sales_sessions s join public.field_sales_employees e
        on e.organization_id=s.organization_id and e.user_id=s.employee_id
      where s.organization_id=$1 and s.punched_out_at is null
        and s.punched_in_at<=clock_timestamp()-interval '14 hours'
      order by s.punched_in_at,s.id limit 201`, [org])).rows : [];
    if (overdue.length > 200) throw new Error('field_operations_too_large');
    return { date, timezone: region.data.timezone, generated_at: observedAt.toISOString(), role,
      overdue,
      rows: dailyAttendance(date, region.data.timezone, observedAt, visible, sessions, events, leaves, points, quality) };
  });
}

/** One bounded, tenant-scoped read for every local date in an employee's month. */
export async function readAttendanceMonth(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string,
  month: string, employeeId: string) {
  z.uuid().parse(employeeId);
  const reports = await readAttendanceMonths(pool, org, actor, month, employeeId);
  return reports[0]!;
}

/** Manager-only, bounded export of the whole enrolled team in one tenant-scoped read. */
export async function readAttendanceTeamMonth(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, month: string) {
  return readAttendanceMonths(pool, org, actor, month);
}

async function readAttendanceMonths(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string,
  month: string, employeeId?: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1 || Number(month.slice(0, 4)) > 9998)
    throw new Error('field_invalid_month');
  return fieldTransaction(pool, org, actor, async (db, role) => {
    const manager = role === 'manager' || role === 'admin';
    if (employeeId ? !manager && actor !== employeeId : !manager) throw new Error('field_forbidden');
    const sessionLimit = employeeId ? 1000 : 10000;
    const eventLimit = employeeId ? 10000 : 50000;
    const people = (await db.query(`select user_id,display_name,active from public.field_sales_employees
      where organization_id=$1 ${employeeId ? 'and user_id=$2' : ''}
      order by display_name,user_id limit ${employeeId ? '2' : '201'}`, employeeId ? [org, employeeId] : [org])).rows;
    if (people.length > 200) throw new Error('field_operations_too_large');
    if (!people.length && employeeId) throw new Error('field_forbidden');
    const ids = people.map(person => person.user_id);
    const region = organizationRegion((await db.query('select timezone,onboarding_state from public.organizations where id=$1', [org])).rows[0]);
    if (!region.success) throw new Error('field_region_required');
    const firstDate = `${month}-01`;
    const nextMonthDate = new Date(`${firstDate}T00:00:00.000Z`);
    nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
    const nextMonth = nextMonthDate.toISOString().slice(0, 10);
    const start = wallTimeToUtc(firstDate, '00:00', region.data.timezone);
    const end = wallTimeToUtc(nextMonth, '00:00', region.data.timezone);
    const sessions = (await db.query(`select s.id,s.employee_id,s.punched_in_at,s.punched_out_at,
      p.name as project_name,
      c.proposed_in as corrected_in,c.proposed_out as corrected_out
      from public.field_sales_sessions s
      left join public.field_sales_projects p on p.organization_id=s.organization_id and p.id=s.project_id
      left join lateral(select proposed_in,proposed_out from public.field_sales_corrections c
        where c.organization_id=s.organization_id and c.session_id=s.id and c.status='approved'
        order by reviewed_at desc,id desc limit 1)c on true
      where s.organization_id=$1 and s.employee_id=any($2::uuid[])
        and coalesce(c.proposed_in,s.punched_in_at)<$4 and coalesce(c.proposed_out,s.punched_out_at,now())>$3
      order by s.punched_in_at,s.id limit ${sessionLimit + 1}`, [org, ids, start, end])).rows;
    if (sessions.length > sessionLimit) throw new Error('field_operations_too_large');
    const events = (await db.query(`select session_id,action,captured_at from public.field_sales_attendance_events
      where organization_id=$1 and session_id=any($2::uuid[]) order by captured_at,sequence limit ${eventLimit + 1}`,
    [org, sessions.map(session => session.id)])).rows;
    if (events.length > eventLimit) throw new Error('field_operations_too_large');
    const leaves = (await db.query(`select employee_id,local_date::text as local_date,note from public.field_sales_leave_days
      where organization_id=$1 and employee_id=any($2::uuid[]) and local_date >= $3::date and local_date < $4::date`,
    [org, ids, firstDate, nextMonth])).rows;
    const observedAt = new Date();
    return people.map(person => {
      const personSessions = sessions.filter(session => session.employee_id === person.user_id);
      const personLeaves = leaves.filter(item => item.employee_id === person.user_id);
      const personSessionIds = new Set(personSessions.map(session => session.id));
      const personEvents = events.filter(event => personSessionIds.has(event.session_id));
      const rows = [];
      for (let date = firstDate; date < nextMonth; date = addCalendarDays(date, 1)) {
        const leave = personLeaves.filter(item => item.local_date === date);
        const projectNames = [...new Set(personSessions.filter(session =>
        localParts(new Date(session.corrected_in ?? session.punched_in_at).getTime(), region.data.timezone).slice(0, 10) === date
        && session.project_name).map(session => session.project_name as string))].sort((a, b) => a.localeCompare(b));
        rows.push({ date, ...dailyAttendance(date, region.data.timezone, observedAt, [person], personSessions, personEvents,
        leave, [], DEFAULT_ROUTE_QUALITY)[0]!, project_names: projectNames });
      }
      return { month, timezone: region.data.timezone, generated_at: observedAt.toISOString(), role,
        employee: { id: person.user_id, name: person.display_name }, rows };
    });
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

const managerShiftCommand = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('close_shift'), session_id: z.uuid(), reason: z.string().trim().min(5).max(2000) }),
  z.strictObject({ operation: z.literal('correct_shift'), id: z.uuid(), session_id: z.uuid(),
    proposed_in: z.iso.datetime({ offset: true }), proposed_out: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(5).max(2000) }),
]);

/** Manager decisions are audited; corrections affect reports, never original punches or GPS. */
export async function manageAttendanceShift(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = managerShiftCommand.parse(raw);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    if (role !== 'manager' && role !== 'admin') throw new Error('field_forbidden');
    const target = (await db.query('select employee_id from public.field_sales_sessions where organization_id=$1 and id=$2',
      [org, input.session_id])).rows[0];
    if (!target || target.employee_id === actor) throw new Error('field_forbidden');
    await requireFieldScope(db, org, actor, role, target.employee_id, true);
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`field-session:${org}:${target.employee_id}`]);
    const session = (await db.query(`select employee_id,punched_in_at,punched_out_at,last_event_at from public.field_sales_sessions
      where organization_id=$1 and id=$2 for update`, [org, input.session_id])).rows[0];
    if (!session || session.employee_id !== target.employee_id) throw new Error('field_revision_conflict');
    if (input.operation === 'close_shift') {
      if (session.punched_out_at) return { saved: true, replayed: true, punched_out_at: (session.punched_out_at as Date).toISOString() };
      const now = (await db.query('select clock_timestamp() as at')).rows[0].at as Date;
      if (now <= session.punched_in_at) throw new Error('field_revision_conflict');
      await db.query(`update public.field_sales_sessions set status='off_duty',punched_out_at=$3
        where organization_id=$1 and id=$2 and punched_out_at is null`, [org, input.session_id, now]);
      await db.query(`delete from public.field_sales_locations where organization_id=$1 and session_id=$2 and captured_at >= $3`,
        [org, input.session_id, now]);
      await fieldAudit(db, org, actor, 'field_sales.manager_close_shift', input.session_id, { reason: input.reason });
      return { saved: true, punched_out_at: now.toISOString() };
    }
    if (!session.punched_out_at) throw new Error('field_closed_session_required');
    const start = Date.parse(input.proposed_in), end = Date.parse(input.proposed_out);
    const now = (await db.query('select clock_timestamp() as at')).rows[0].at as Date;
    if (start >= end || end > now.getTime() || start < 0) throw new Error('field_invalid_correction');
    const existing = (await db.query('select * from public.field_sales_corrections where organization_id=$1 and id=$2 for update',
      [org, input.id])).rows[0];
    if (existing) {
      if (existing.session_id !== input.session_id || existing.employee_id !== target.employee_id ||
        existing.reason !== input.reason || existing.proposed_in.getTime() !== start || existing.proposed_out.getTime() !== end)
        throw new Error('field_idempotency_conflict');
      return { saved: true, replayed: true };
    }
    const pending = await db.query(`select 1 from public.field_sales_corrections
      where organization_id=$1 and session_id=$2 and status='pending' limit 1`, [org, input.session_id]);
    if (pending.rowCount) throw new Error('field_revision_conflict');
    const overlap = await db.query(`select 1 from public.field_sales_sessions s
      left join lateral(select c.proposed_in,c.proposed_out from public.field_sales_corrections c
        where c.organization_id=s.organization_id and c.session_id=s.id and c.status='approved'
        order by c.reviewed_at desc,c.id desc limit 1)c on true
      where s.organization_id=$1 and s.employee_id=$2 and s.id<>$3
        and coalesce(c.proposed_in,s.punched_in_at)<$5::timestamptz
        and coalesce(c.proposed_out,s.punched_out_at,clock_timestamp())>$4::timestamptz limit 1`,
    [org, target.employee_id, input.session_id, input.proposed_in, input.proposed_out]);
    if (overlap.rowCount) throw new Error('field_session_overlap');
    await db.query(`insert into public.field_sales_corrections
      (organization_id,id,employee_id,session_id,proposed_in,proposed_out,reason,status,reviewed_by,review_note,reviewed_at)
      values($1,$2,$3,$4,$5,$6,$7,'approved',$8,'Manager verified working hours',clock_timestamp())`,
    [org, input.id, target.employee_id, input.session_id, input.proposed_in, input.proposed_out, input.reason, actor]);
    await fieldAudit(db, org, actor, 'field_sales.manager_correct_shift', input.session_id, { reason: input.reason, correction_id: input.id });
    return { saved: true, replayed: false };
  });
}
