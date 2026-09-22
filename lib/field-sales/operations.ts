import type pg from 'pg';
import { z } from 'zod';
import { fieldAudit, fieldTransaction, requireFieldEmployee, requireFieldScope, type FieldDb, type FieldRole } from './authority';
import { fieldFingerprint } from './attendance';
import { expandSchedule, addCalendarDays, wallTimeToUtc } from './schedule';
import { localDateSchema, organizationRegion } from './contracts';

export const visitCommandSchema = z.strictObject({
  command_id: z.uuid(), visit_id: z.uuid(), schedule_id: z.uuid(), date: localDateSchema,
  session_id: z.uuid().nullable(), action: z.enum(['travel', 'arrive', 'complete', 'skip']),
  notes: z.string().trim().max(8000), next_action: z.string().trim().max(2000),
  next_action_at: z.iso.datetime({ offset: true }).nullable(),
  captured_at: z.iso.datetime({ offset: true }).optional(),
});
export async function recordVisit(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = visitCommandSchema.parse(raw), fingerprint = fieldFingerprint(input);
  return fieldTransaction(pool, org, actor, async db => {
    await requireFieldEmployee(db, org, actor);
    // Same calendar lock as edits: an assignment cannot move between validation and visit creation.
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`field-calendar:${org}`]);
    const receipt = (await db.query('select fingerprint,employee_id from public.field_sales_visit_events where organization_id=$1 and id=$2', [org, input.command_id])).rows[0];
    if (receipt) {
      if (receipt.employee_id !== actor || receipt.fingerprint !== fingerprint) throw new Error('field_idempotency_conflict');
      return { visit_id: input.visit_id, replayed: true };
    }
    const receivedAt = (await db.query('select clock_timestamp() as at')).rows[0].at as Date;
    const capturedAt = input.captured_at ? new Date(input.captured_at) : receivedAt;
    if (capturedAt.getTime() > receivedAt.getTime() + 60000) throw new Error('field_device_clock_ahead');
    const schedule = (await db.query('select * from public.field_sales_schedules where organization_id=$1 and id=$2 for share', [org, input.schedule_id])).rows[0];
    if (!schedule || schedule.employee_id !== actor || !schedule.active) throw new Error('field_assignment_unavailable');
    const occurrence = expandSchedule({ series_id: input.schedule_id, schedule: schedule.rule,
      region: { country_code: schedule.country_code, timezone: schedule.timezone }, from: input.date, through: input.date })[0];
    if (!occurrence) throw new Error('field_assignment_unavailable');
    const cancelled = await db.query('select local_date from public.field_sales_schedule_exceptions where organization_id=$1 and schedule_id=$2 and local_date=$3 and cancelled', [org, input.schedule_id, input.date]);
    if (cancelled.rowCount) throw new Error('field_assignment_unavailable');
    const visit = (await db.query('select * from public.field_sales_visits where organization_id=$1 and id=$2 for update', [org, input.visit_id])).rows[0];
    if (visit && (visit.employee_id !== actor || visit.schedule_id !== input.schedule_id || String(visit.local_date).slice(0, 10) !== input.date)) {
      // pg DATE can be represented as a Date; compare calendar identity in SQL below instead.
      const same = await db.query('select id from public.field_sales_visits where organization_id=$1 and id=$2 and employee_id=$3 and schedule_id=$4 and local_date=$5', [org, input.visit_id, actor, input.schedule_id, input.date]);
      if (!same.rowCount) throw new Error('field_forbidden');
    }
    const next = input.action === 'travel' ? 'traveling' : input.action === 'arrive' ? 'arrived' : input.action === 'complete' ? 'completed' : 'skipped';
    if ((!visit && !['travel', 'skip'].includes(input.action)) || (visit && !((visit.status === 'traveling' && ['arrive', 'skip'].includes(input.action)) || (visit.status === 'arrived' && ['complete', 'skip'].includes(input.action)))))
      throw new Error('field_invalid_transition');
    if (input.action !== 'skip') {
      const session = await db.query(`select s.id from public.field_sales_sessions s
        where s.organization_id=$1 and s.id=$2 and s.employee_id=$3 and s.punched_in_at<=$4
        and (s.punched_out_at is null or s.punched_out_at>$4)
        and (select e.action from public.field_sales_attendance_events e
          where e.organization_id=$1 and e.session_id=s.id and e.captured_at<=$4
          order by e.sequence desc limit 1) in ('punch_in','break_end') for share`, [org, input.session_id, actor, capturedAt]);
      if (!session.rowCount) throw new Error('field_work_session_required');
      if (visit && visit.session_id !== input.session_id) throw new Error('field_work_session_required');
    }
    if (visit && capturedAt < new Date(visit.arrived_at ?? visit.started_at)) throw new Error('field_device_clock_reversed');
    if (['complete', 'skip'].includes(input.action) && !input.notes) throw new Error('field_visit_outcome_required');
    if (input.next_action && !input.next_action_at) throw new Error('field_next_action_date_required');
    if (!visit) await db.query(`insert into public.field_sales_visits(organization_id,id,employee_id,project_id,schedule_id,local_date,session_id,status,notes,next_action,next_action_at,started_at,completed_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,case when $8='skipped' then $12::timestamptz else null end)`,
      [org, input.visit_id, actor, schedule.project_id, input.schedule_id, input.date, input.session_id, next, input.notes, input.next_action, input.next_action_at, capturedAt]);
    else await db.query(`update public.field_sales_visits set status=$3,revision=revision+1,notes=$4,next_action=$5,next_action_at=$6,next_action_completed_at=null,next_action_completed_by=null,
      arrived_at=case when $3='arrived' then $7::timestamptz else arrived_at end,completed_at=case when $3 in ('completed','skipped') then $7::timestamptz else null end
      where organization_id=$1 and id=$2`, [org, input.visit_id, next, input.notes, input.next_action, input.next_action_at, capturedAt]);
    await db.query('insert into public.field_sales_visit_events(organization_id,id,visit_id,employee_id,action,fingerprint) values($1,$2,$3,$4,$5,$6)', [org, input.command_id, input.visit_id, actor, input.action, fingerprint]);
    await fieldAudit(db, org, actor, 'field_sales.visit_' + input.action, input.visit_id);
    return { visit_id: input.visit_id, replayed: false };
  });
}

export const correctionSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('request'), id: z.uuid(), session_id: z.uuid(),
    proposed_in: z.iso.datetime({ offset: true }), proposed_out: z.iso.datetime({ offset: true }), reason: z.string().trim().min(1).max(2000) }),
  z.strictObject({ operation: z.literal('review'), id: z.uuid(), decision: z.enum(['approved', 'rejected']), note: z.string().trim().min(1).max(2000) }),
]);
export const completeNextActionSchema = z.strictObject({ visit_id: z.uuid(), revision: z.number().int().positive() });
export async function completeNextAction(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = completeNextActionSchema.parse(raw);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    const visit = (await db.query('select employee_id,revision,next_action,next_action_completed_at from public.field_sales_visits where organization_id=$1 and id=$2 for update', [org, input.visit_id])).rows[0];
    if (!visit) throw new Error('field_forbidden');
    await requireFieldScope(db, org, actor, role, visit.employee_id);
    if (!visit.next_action) throw new Error('field_next_action_missing');
    if (visit.next_action_completed_at && visit.revision === input.revision + 1) return { completed: true, replayed: true };
    if (visit.revision !== input.revision || visit.next_action_completed_at) throw new Error('field_revision_conflict');
    await db.query('update public.field_sales_visits set next_action_completed_at=now(),next_action_completed_by=$3,revision=revision+1 where organization_id=$1 and id=$2', [org, input.visit_id, actor]);
    await fieldAudit(db, org, actor, 'field_sales.next_action_completed', input.visit_id);
    return { completed: true, replayed: false };
  });
}
export async function manageCorrection(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = correctionSchema.parse(raw);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    const existing = (await db.query('select * from public.field_sales_corrections where organization_id=$1 and id=$2 for update', [org, input.id])).rows[0];
    if (input.operation === 'request') {
      await requireFieldEmployee(db, org, actor);
      if (existing) {
        if (existing.employee_id !== actor || existing.session_id !== input.session_id || existing.reason !== input.reason || existing.proposed_in.toISOString() !== new Date(input.proposed_in).toISOString() || existing.proposed_out.toISOString() !== new Date(input.proposed_out).toISOString()) throw new Error('field_idempotency_conflict');
        return { id: input.id, replayed: true };
      }
      const session = await db.query('select id from public.field_sales_sessions where organization_id=$1 and employee_id=$2 and id=$3 and punched_out_at is not null for update', [org, actor, input.session_id]);
      if (!session.rowCount) throw new Error('field_closed_session_required');
      if (Date.parse(input.proposed_out) <= Date.parse(input.proposed_in) || Date.parse(input.proposed_out) > Date.now()) throw new Error('field_invalid_correction');
      await db.query(`insert into public.field_sales_corrections(organization_id,id,employee_id,session_id,proposed_in,proposed_out,reason)
        values($1,$2,$3,$4,$5,$6,$7)`, [org, input.id, actor, input.session_id, input.proposed_in, input.proposed_out, input.reason]);
    } else {
      if (!existing || (role !== 'manager' && role !== 'admin') || existing.employee_id === actor) throw new Error('field_forbidden');
      await requireFieldScope(db, org, actor, role, existing.employee_id, true);
      if (existing.status !== 'pending') throw new Error('field_revision_conflict');
      await db.query(`update public.field_sales_corrections set status=$3,reviewed_by=$4,review_note=$5,reviewed_at=now()
        where organization_id=$1 and id=$2`, [org, input.id, input.decision, actor, input.note]);
      // A correction changes reporting only. Original capture intervals/GPS acceptance never expand.
    }
    await fieldAudit(db, org, actor, 'field_sales.correction_' + input.operation, input.id);
    return { id: input.id, replayed: false };
  });
}

async function visibleEmployees(db: FieldDb, org: string, actor: string, role: FieldRole) {
  return (await db.query(`select user_id,display_name,active from public.field_sales_employees where organization_id=$1
    and ($3 in ('admin','manager') or user_id=$2) order by display_name for share`, [org, actor, role])).rows;
}
export async function readFieldOperations(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, date: string,
  sessionId?: string | null, employeeId?: string | null) {
  localDateSchema.parse(date); if (sessionId) z.uuid().parse(sessionId); if (employeeId) z.uuid().parse(employeeId);
  if (sessionId && employeeId) throw new Error('field_invalid_request');
  return fieldTransaction(pool, org, actor, async (db, role) => {
    const people = await visibleEmployees(db, org, actor, role), ids = people.map(p => p.user_id);
    const region = organizationRegion((await db.query('select timezone,onboarding_state from public.organizations where id=$1', [org])).rows[0]);
    if (!region.success) throw new Error('field_region_required');
    const start = wallTimeToUtc(date, '00:00', region.data.timezone), end = wallTimeToUtc(addCalendarDays(date, 1), '00:00', region.data.timezone);
    const sessions = (await db.query(`select s.*,e.display_name,p.name as project_name,p.site_name,c.proposed_in as corrected_in,c.proposed_out as corrected_out
      from public.field_sales_sessions s join public.field_sales_employees e on e.organization_id=s.organization_id and e.user_id=s.employee_id
      left join public.field_sales_projects p on p.organization_id=s.organization_id and p.id=s.project_id
      left join lateral(select proposed_in,proposed_out from public.field_sales_corrections c where c.organization_id=$1 and c.session_id=s.id and c.status='approved' order by reviewed_at desc,id desc limit 1)c on true
      where s.organization_id=$1 and e.organization_id=$1 and s.employee_id=any($2::uuid[]) and s.punched_in_at<$4 and coalesce(s.punched_out_at,now())>=$3
      order by s.punched_in_at desc limit 501`, [org, ids, start, end])).rows;
    if (sessions.length > 500) throw new Error('field_operations_too_large');
    const latest = (await db.query(`select e.user_id as employee_id,e.display_name,s.id as session_id,s.status,l.latitude,l.longitude,l.accuracy_m,l.captured_at,l.received_at,l.mock_location,
      presence.last_seen_at,coalesce(presence.last_seen_at>=now()-interval '2 minutes',false) as online
      from public.field_sales_employees e left join public.field_sales_sessions s on s.organization_id=e.organization_id and s.employee_id=e.user_id and s.punched_out_at is null
      left join lateral(select max(d.last_seen_at) as last_seen_at from public.field_sales_devices d
        where d.organization_id=e.organization_id and d.employee_id=e.user_id and d.token_hash is not null
        and d.revoked_at is null and (d.expires_at is null or d.expires_at>now()))presence on true
      left join lateral(select l.* from public.field_sales_locations l join public.field_sales_settings policy on policy.organization_id=l.organization_id
        where l.organization_id=$1 and l.session_id=s.id and l.captured_at>=s.punched_in_at and l.captured_at>=now()-make_interval(days=>policy.retention_days)
        order by l.captured_at desc,l.sequence desc limit 1)l on true
      where e.organization_id=$1 and e.user_id=any($2::uuid[]) order by e.display_name`, [org, ids])).rows;
    const visits = (await db.query(`select v.*,v.local_date::text as local_date,p.name as project_name,e.display_name from public.field_sales_visits v
      join public.field_sales_projects p on p.organization_id=v.organization_id and p.id=v.project_id
      join public.field_sales_employees e on e.organization_id=v.organization_id and e.user_id=v.employee_id
      where v.organization_id=$1 and p.organization_id=$1 and e.organization_id=$1 and v.employee_id=any($2::uuid[]) and (v.local_date=$3 or (v.next_action_at<=now() and v.next_action<>'' and v.next_action_completed_at is null)) order by v.started_at desc limit 501`, [org, ids, date])).rows;
    const collections = (await db.query(`select c.id,c.employee_id,c.project_id,c.project_customer_id,c.session_id,
      c.captured_at,c.amount_cents,c.balance_after_cents,c.currency,c.voided_at,c.void_reason,shop.shop_name,shop.customer_code,
      p.name as project_name,loc.latitude,loc.longitude,loc.accuracy_m
      from public.field_sales_customer_collections c
      join public.field_sales_project_customers shop on shop.organization_id=c.organization_id and shop.id=c.project_customer_id
      join public.field_sales_projects p on p.organization_id=c.organization_id and p.id=c.project_id
      left join lateral(select l.latitude,l.longitude,l.accuracy_m from public.field_sales_locations l
        join public.field_sales_settings policy on policy.organization_id=l.organization_id
        where l.organization_id=c.organization_id and l.session_id=c.session_id and not l.mock_location
          and l.accuracy_m<=50 and l.captured_at between c.captured_at-interval '2 minutes' and c.captured_at+interval '2 minutes'
          and l.captured_at>=now()-make_interval(days=>policy.retention_days)
        order by abs(extract(epoch from l.captured_at-c.captured_at)),l.accuracy_m limit 1)loc on true
      where c.organization_id=$1 and shop.organization_id=$1 and p.organization_id=$1
        and c.employee_id=any($2::uuid[]) and c.captured_at>=$3 and c.captured_at<$4
      order by c.captured_at desc,c.id limit 501`, [org, ids, start, end])).rows;
    const activities = (await db.query(`select a.id,a.employee_id,a.session_id,a.project_id,a.project_customer_id,
      a.note,a.source,a.captured_at,p.name as project_name,shop.shop_name
      from public.field_sales_activity_notes a
      join public.field_sales_projects p on p.organization_id=a.organization_id and p.id=a.project_id
      left join public.field_sales_project_customers shop on shop.organization_id=a.organization_id and shop.id=a.project_customer_id
      where a.organization_id=$1 and a.employee_id=any($2::uuid[]) and a.captured_at>=$3 and a.captured_at<$4
      order by a.captured_at desc,a.id limit 501`, [org, ids, start, end])).rows;
    const corrections = (await db.query(`select c.*,e.display_name from public.field_sales_corrections c join public.field_sales_employees e on e.organization_id=c.organization_id and e.user_id=c.employee_id
      where c.organization_id=$1 and e.organization_id=$1 and c.employee_id=any($2::uuid[]) and (c.status='pending' or c.created_at>=$3) order by c.created_at desc limit 501`, [org, ids, start])).rows;
    if (visits.length > 500 || corrections.length > 500 || collections.length > 500 || activities.length > 500) throw new Error('field_operations_too_large');
    let points: Array<{ session_id: string; latitude: number; longitude: number; captured_at: Date; accuracy_m: number; mock_location: boolean }> = [];
    if (sessionId || employeeId) {
      if (employeeId && !ids.includes(employeeId)) throw new Error('field_forbidden');
      const selected = await db.query('select id from public.field_sales_sessions where organization_id=$1 and id=$2 and employee_id=any($3::uuid[])', [org, sessionId, ids]);
      if (sessionId && !selected.rowCount) throw new Error('field_forbidden');
      points = (await db.query(`select l.session_id,l.latitude,l.longitude,l.captured_at,l.accuracy_m,l.mock_location from public.field_sales_locations l
        join public.field_sales_sessions s on s.organization_id=l.organization_id and s.id=l.session_id
        join public.field_sales_settings policy on policy.organization_id=l.organization_id
        where l.organization_id=$1 and s.organization_id=$1 and ($2::uuid is null or l.session_id=$2)
        and ($4::uuid is null or s.employee_id=$4) and s.employee_id=any($3::uuid[])
        and l.captured_at>=$5 and l.captured_at<$6 and l.captured_at>=s.punched_in_at
        and (s.punched_out_at is null or l.captured_at<s.punched_out_at) and l.captured_at>=now()-make_interval(days=>policy.retention_days)
        order by l.captured_at,l.sequence limit 10001`, [org, sessionId || null, ids, employeeId || null, start, end])).rows;
      if (points.length > 10000) throw new Error('field_operations_too_large');
      await fieldAudit(db, org, actor, 'field_sales.route_viewed', sessionId || employeeId!, { date });
    }
    const map = (await db.query('select map_tile_path,map_attribution from public.field_sales_settings where organization_id=$1', [org])).rows[0] ?? null;
    return { role, region: region.data, people, sessions, latest, visits, collections, activities, corrections, points, map, generated_at: new Date().toISOString() };
  });
}
