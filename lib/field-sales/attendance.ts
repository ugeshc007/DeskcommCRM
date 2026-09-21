import { createHash } from 'node:crypto';
import type pg from 'pg';
import { attendanceCommandSchema, locationBatchSchema, sampleWithinSession, transitionAttendance, MAX_FIELD_SHIFT_MS, type WorkStatus } from './contracts';
import { fieldAudit, fieldTransaction, requireFieldEmployee, type FieldDb } from './authority';
import { expandSchedule, localParts } from './schedule';

export function fieldFingerprint(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function trackingPolicy(db: FieldDb, org: string) {
  const row = (await db.query(`select enabled,retention_days from public.field_sales_settings
    where organization_id=$1 for share`, [org])).rows[0];
  if (!row?.enabled) throw new Error('field_tracking_disabled');
  return row as { enabled: boolean; retention_days: number };
}

export async function recordAttendance(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const command = attendanceCommandSchema.parse(raw);
  return fieldTransaction(pool, org, actor, async db => {
    await requireFieldEmployee(db, org, actor);
    // One lock per employee, not per device. Two devices cannot start two work sessions.
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`field-session:${org}:${actor}`]);
    const previous = (await db.query(`select e.fingerprint,s.employee_id from public.field_sales_attendance_events e
      join public.field_sales_sessions s on s.organization_id=e.organization_id and s.id=e.session_id
      where e.organization_id=$1 and e.id=$2`, [org, command.event_id])).rows[0];
    const fingerprint = fieldFingerprint(command);
    if (previous) {
      if (previous.employee_id !== actor || previous.fingerprint !== fingerprint) throw new Error('field_idempotency_conflict');
      return { event_id: command.event_id, replayed: true };
    }
    // Stopping remains possible when an administrator disabled collection.
    if (command.action !== 'punch_out') await trackingPolicy(db, org);
    const at = Date.parse(command.captured_at);
    const now = (await db.query('select clock_timestamp() as at')).rows[0].at as Date;
    if (at > now.getTime() + 60000) throw new Error('field_device_clock_ahead');
    const session = (await db.query(`select id,employee_id,status,last_sequence,last_event_at,punched_in_at,punched_out_at,local_date::text as local_date
      from public.field_sales_sessions where organization_id=$1 and id=$2 for update`, [org, command.session_id])).rows[0];
    if (session && session.employee_id !== actor) throw new Error('field_forbidden');
    if (command.action === 'punch_in') {
      if (session || command.sequence !== 0) throw new Error('field_invalid_transition');
      const active = await db.query('select id from public.field_sales_sessions where organization_id=$1 and employee_id=$2 and punched_out_at is null', [org, actor]);
      if (active.rowCount) throw new Error('field_session_already_active');
      const recent = (await db.query('select max(punched_out_at) as ended from public.field_sales_sessions where organization_id=$1 and employee_id=$2', [org, actor])).rows[0].ended as Date | null;
      if (recent && at < recent.getTime()) throw new Error('field_session_overlap');
      const region = (await db.query('select timezone from public.organizations where id=$1', [org])).rows[0];
      if (!region?.timezone || localParts(at, region.timezone).slice(0, 10) !== command.local_date)
        throw new Error('field_assignment_unavailable');
      if (!!command.project_id !== !!command.schedule_id) throw new Error('field_assignment_unavailable');
      if (command.schedule_id) {
        const schedule = (await db.query(`select employee_id,project_id,timezone,country_code,rule,active from public.field_sales_schedules
          where organization_id=$1 and id=$2 for share`, [org, command.schedule_id])).rows[0];
        if (!schedule?.active || schedule.employee_id !== actor || schedule.project_id !== command.project_id ||
          !expandSchedule({ series_id: command.schedule_id, schedule: schedule.rule,
            region: { country_code: schedule.country_code, timezone: schedule.timezone }, from: command.local_date, through: command.local_date }).length)
          throw new Error('field_assignment_unavailable');
        const cancelled = await db.query('select 1 from public.field_sales_schedule_exceptions where organization_id=$1 and schedule_id=$2 and local_date=$3 and cancelled', [org, command.schedule_id, command.local_date]);
        if (cancelled.rowCount) throw new Error('field_assignment_unavailable');
      }
      await db.query(`insert into public.field_sales_sessions(organization_id,id,employee_id,project_id,schedule_id,local_date,status,punched_in_at,last_event_at,last_sequence)
        values($1,$2,$3,$4,$5,$6,'working',$7,$7,0)`,
      [org, command.session_id, actor, command.project_id ?? null, command.schedule_id ?? null, command.local_date, command.captured_at]);
    } else if (command.action === 'select_project') {
      if (!session || command.sequence !== session.last_sequence + 1 || session.punched_out_at && at >= (session.punched_out_at as Date).getTime())
        throw new Error('field_sync_out_of_order');
      if (at < (session.last_event_at as Date).getTime() || at >= (session.punched_in_at as Date).getTime() + MAX_FIELD_SHIFT_MS)
        throw new Error('field_outside_work_session');
      const project = await db.query('select id from public.field_sales_projects where organization_id=$1 and id=$2 and active for share', [org, command.project_id]);
      if (!project.rowCount) throw new Error('field_assignment_unavailable');
      if (command.local_date !== String(session.local_date).slice(0, 10)) throw new Error('field_assignment_unavailable');
      if (command.schedule_id) {
        const schedule = (await db.query(`select employee_id,project_id,timezone,country_code,rule,active from public.field_sales_schedules
          where organization_id=$1 and id=$2 for share`, [org, command.schedule_id])).rows[0];
        if (!schedule?.active || schedule.employee_id !== actor || schedule.project_id !== command.project_id ||
          !expandSchedule({ series_id: command.schedule_id, schedule: schedule.rule,
            region: { country_code: schedule.country_code, timezone: schedule.timezone }, from: command.local_date, through: command.local_date }).length)
          throw new Error('field_assignment_unavailable');
        const cancelled = await db.query('select 1 from public.field_sales_schedule_exceptions where organization_id=$1 and schedule_id=$2 and local_date=$3 and cancelled', [org, command.schedule_id, command.local_date]);
        if (cancelled.rowCount) throw new Error('field_assignment_unavailable');
      }
      await db.query(`update public.field_sales_sessions set project_id=$3,schedule_id=$4,last_event_at=$5,last_sequence=$6
        where organization_id=$1 and id=$2`, [org, command.session_id, command.project_id, command.schedule_id, command.captured_at, command.sequence]);
    } else {
      if (!session || command.sequence !== session.last_sequence + 1) throw new Error('field_sync_out_of_order');
      if (at < (session.last_event_at as Date).getTime()) throw new Error('field_device_clock_reversed');
      const cutoff = (session.punched_in_at as Date).getTime() + MAX_FIELD_SHIFT_MS;
      const autoClosed = session.status === 'off_duty' && (session.punched_out_at as Date)?.getTime() === cutoff;
      if (at >= cutoff && command.action !== 'punch_out') throw new Error('field_outside_work_session');
      const next = autoClosed ? 'off_duty'
        : transitionAttendance(session.status as WorkStatus, command.action);
      const effectiveAt = command.action === 'punch_out' && at > cutoff ? new Date(cutoff).toISOString() : command.captured_at;
      await db.query(`update public.field_sales_sessions set status=$3,last_event_at=$4,last_sequence=$5,
        punched_out_at=case when $6::boolean then punched_out_at when $3='off_duty' then $4::timestamptz else null end where organization_id=$1 and id=$2`,
      [org, command.session_id, next, effectiveAt, command.sequence, autoClosed]);
      if (next === 'off_duty') {
        // An offline stop can arrive after newer samples: remove those outside its work interval.
        await db.query('delete from public.field_sales_locations where organization_id=$1 and session_id=$2 and captured_at >= $3', [org, command.session_id, effectiveAt]);
      }
    }
    await db.query(`insert into public.field_sales_attendance_events(organization_id,id,session_id,sequence,action,captured_at,fingerprint)
      values($1,$2,$3,$4,$5,$6,$7)`, [org, command.event_id, command.session_id, command.sequence, command.action, command.captured_at, fingerprint]);
    await fieldAudit(db, org, actor, 'field_sales.' + command.action, command.session_id,
      { sequence: command.sequence, ...(command.action === 'select_project'
        ? { project_id: command.project_id, ...(command.schedule_id ? { schedule_id: command.schedule_id } : {}),
          override: command.schedule_id === null } : {}) });
    return { event_id: command.event_id, replayed: false };
  });
}

export async function recordLocations(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown, acknowledgeRejected = false) {
  const { samples } = locationBatchSchema.parse(raw);
  return fieldTransaction(pool, org, actor, async db => {
    await requireFieldEmployee(db, org, actor);
    const policy = await trackingPolicy(db, org);
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`field-session:${org}:${actor}`]);
    const now = (await db.query('select clock_timestamp() as at')).rows[0].at as Date;
    const sessions = await db.query(`select id,employee_id,punched_in_at,punched_out_at from public.field_sales_sessions
      where organization_id=$1 and employee_id=$2 and id=any($3::uuid[]) for share`, [org, actor, [...new Set(samples.map(s => s.session_id))]]);
    const byId = new Map(sessions.rows.map(s => [s.id, { id: s.id as string,
      punched_in_at: (s.punched_in_at as Date).toISOString(), punched_out_at: s.punched_out_at ? (s.punched_out_at as Date).toISOString() : null }]));
    let inserted = 0;
    const accepted: string[] = [], rejected: Array<{ sample_id: string; reason: string }> = [];
    for (const sample of samples) {
      const session = byId.get(sample.session_id);
      const at = Date.parse(sample.captured_at);
      const rejection = !session || !sampleWithinSession(sample, session) ? 'field_outside_work_session'
        : at < now.getTime() - policy.retention_days * 86400000 ? 'field_sample_expired' : null;
      if (rejection) {
        if (!acknowledgeRejected) throw new Error(rejection);
        rejected.push({ sample_id: sample.sample_id, reason: rejection });
        continue;
      }
      if (at > now.getTime() + 60000) throw new Error('field_device_clock_ahead');
      const fingerprint = fieldFingerprint(sample);
      const old = (await db.query(`select fingerprint from public.field_sales_locations where organization_id=$1
        and (id=$2 or (session_id=$3 and sequence=$4))`, [org, sample.sample_id, sample.session_id, sample.sequence])).rows;
      if (old.length) {
        if (old.length !== 1 || old[0].fingerprint !== fingerprint) throw new Error('field_idempotency_conflict');
        accepted.push(sample.sample_id);
        continue;
      }
      await db.query(`insert into public.field_sales_locations(organization_id,id,session_id,sequence,captured_at,latitude,longitude,accuracy_m,mock_location,fingerprint)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [org, sample.sample_id, sample.session_id, sample.sequence, sample.captured_at,
        sample.latitude, sample.longitude, sample.accuracy_m, sample.mock_location, fingerprint]);
      inserted++;
      accepted.push(sample.sample_id);
    }
    if (inserted) await fieldAudit(db, org, actor, 'field_sales.location_batch_received', actor, { count: inserted });
    if (rejected.length) await fieldAudit(db, org, actor, 'field_sales.location_batch_rejected', actor, { count: rejected.length });
    return { accepted, rejected, inserted };
  });
}
