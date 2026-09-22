import type pg from 'pg';
import { z } from 'zod';
import { fieldAudit, fieldTransaction, requireFieldEmployee, requireFieldScope } from './authority';
import { localDateSchema, organizationRegion, projectSchema, scheduleSchema, type FieldSchedule } from './contracts';
import { addCalendarDays, expandSchedule, localParts, overlappingAssignments, type ScheduleOccurrence } from './schedule';
import { planReschedule } from './reschedule';

const version = { id: z.uuid(), revision: z.number().int().nonnegative() };
export const fieldManagementSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('map_config'), tile_path: z.string().regex(/^\/field-map-tiles\/(?:[a-z0-9/_-]*\{z\}\/\{x\}\/\{y\}\.(?:png|jpg|webp)|[a-z0-9][a-z0-9_-]{0,79}\.pmtiles)$/).max(300).nullable(), attribution: z.string().trim().max(500) }),
  z.strictObject({ operation: z.literal('settings'), revision: z.number().int().nonnegative(), enabled: z.boolean(),
    retention_days: z.number().int().min(1).max(365), notice_text: z.string().trim().min(1).max(8000) }),
  z.strictObject({ operation: z.literal('employee'), user_id: z.uuid(), display_name: z.string().trim().min(1).max(160), active: z.boolean() }),
  z.strictObject({ operation: z.literal('project'), ...version, project: projectSchema }),
  z.strictObject({ operation: z.literal('schedule'), ...version, schedule: scheduleSchema }),
  z.strictObject({ operation: z.literal('cancel_occurrence'), ...version, date: localDateSchema }),
  z.strictObject({ operation: z.literal('end_schedule'), ...version, effective_date: localDateSchema }),
  z.strictObject({ operation: z.literal('replace_schedule'), ...version, new_id: z.uuid(), effective_date: localDateSchema,
    schedule: scheduleSchema }),
  z.strictObject({ operation: z.literal('edit_schedule'), ...version, schedule: scheduleSchema }),
  z.strictObject({ operation: z.literal('reschedule'), ...version, new_id: z.uuid(), date: localDateSchema,
    scope: z.enum(['one', 'future']), schedule: scheduleSchema }),
]);

export async function manageFieldSales(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  const input = fieldManagementSchema.parse(raw);
  return fieldTransaction(pool, org, actor, async (db, role) => {
    if (role === 'agent' || role === 'field_officer') throw new Error('field_forbidden');
    // Serializes schedule changes for conflict/revision checks. Does not lock GPS ingestion.
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`field-calendar:${org}`]);
    let result: { id?: string; revision?: number } = {};
    if (input.operation === 'map_config') {
      if (role !== 'admin') throw new Error('field_forbidden');
      const saved = await db.query('update public.field_sales_settings set map_tile_path=$2,map_attribution=$3 where organization_id=$1 returning organization_id', [org, input.tile_path, input.attribution]);
      if (!saved.rowCount) throw new Error('field_policy_required');
    } else if (input.operation === 'settings') {
      if (role !== 'admin') throw new Error('field_forbidden');
      const region = organizationRegion((await db.query('select timezone,onboarding_state from public.organizations where id=$1 for share', [org])).rows[0]);
      if (input.enabled && !region.success) throw new Error('field_region_required');
      const old = (await db.query('select revision from public.field_sales_settings where organization_id=$1 for update', [org])).rows[0];
      if ((old?.revision ?? 0) !== input.revision) throw new Error('field_revision_conflict');
      await db.query(`insert into public.field_sales_settings(organization_id,enabled,revision,retention_days,notice_text)
        values($1,$2,$3,$4,$5) on conflict(organization_id) do update set enabled=excluded.enabled,
        revision=excluded.revision,retention_days=excluded.retention_days,notice_text=excluded.notice_text,updated_at=now()`,
      [org, input.enabled, input.revision + 1, input.retention_days, input.notice_text]);
      result = { revision: input.revision + 1 };
    } else if (input.operation === 'employee') {
      if (role !== 'admin') throw new Error('field_forbidden');
      const member = await db.query(`select user_id from public.user_organizations where organization_id=$1
        and user_id=$2 and accepted_at is not null and revoked_at is null and role in ('field_officer','agent','manager','admin') for share`, [org, input.user_id]);
      if (!member.rowCount) throw new Error('field_employee_unavailable');
      await db.query(`insert into public.field_sales_employees(organization_id,user_id,display_name,active) values($1,$2,$3,$4)
        on conflict(organization_id,user_id) do update set display_name=excluded.display_name,active=excluded.active`,
      [org, input.user_id, input.display_name, input.active]);
      result = { id: input.user_id };
    } else if (input.operation === 'project') {
      if (role !== 'admin') throw new Error('field_forbidden');
      const p = input.project;
      if (p.customer_id) {
        const customer = await db.query('select id from public.contacts where organization_id=$1 and id=$2 and not is_anonymized for share', [org, p.customer_id]);
        if (!customer.rowCount) throw new Error('field_customer_unavailable');
      }
      const old = (await db.query('select revision from public.field_sales_projects where organization_id=$1 and id=$2 for update', [org, input.id])).rows[0];
      if ((old?.revision ?? 0) !== input.revision) throw new Error('field_revision_conflict');
      await db.query(`insert into public.field_sales_projects(organization_id,id,revision,name,customer_id,site_name,address,latitude,longitude,instructions,active)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(organization_id,id) do update set revision=excluded.revision,
        name=excluded.name,customer_id=excluded.customer_id,site_name=excluded.site_name,address=excluded.address,
        latitude=excluded.latitude,longitude=excluded.longitude,instructions=excluded.instructions,active=excluded.active`,
      [org, input.id, input.revision + 1, p.name, p.customer_id, p.site_name, p.address, p.latitude, p.longitude, p.instructions, p.active]);
      result = { id: input.id, revision: input.revision + 1 };
    } else {
      const old = (await db.query('select employee_id,revision,rule,timezone,country_code,active from public.field_sales_schedules where organization_id=$1 and id=$2 for update', [org, input.id])).rows[0];
      if ((old?.revision ?? 0) !== input.revision) throw new Error('field_revision_conflict');
      if (old) await requireFieldScope(db, org, actor, role, old.employee_id, true);
      if (old && (input.operation === 'reschedule' || input.operation === 'cancel_occurrence' || input.operation === 'end_schedule' || input.operation === 'replace_schedule')) {
        if ((await db.query("select to_regclass('public.field_sales_visits') is not null installed")).rows[0].installed) {
          const recorded = await db.query(`select id from public.field_sales_visits where organization_id=$1 and schedule_id=$2
            and (local_date=$3 or ($4 and local_date>$3)) limit 1`, [org, input.id,
            input.operation === 'end_schedule' || input.operation === 'replace_schedule' ? input.effective_date : input.date,
            input.operation === 'end_schedule' || input.operation === 'replace_schedule' || input.operation === 'reschedule' && input.scope === 'future']);
          if (recorded.rowCount) throw new Error('field_history_immutable');
        }
      }
      if (input.operation === 'edit_schedule') {
        if (!old?.active) throw new Error('field_assignment_unavailable');
        const today = localParts(Date.now(), old.timezone).slice(0, 10);
        if (input.schedule.start_date < today || input.schedule.employee_id !== old.employee_id)
          throw new Error('field_invalid_edit_scope');
        const previous = scheduleSchema.parse(old.rule);
        if (input.schedule.project_id !== previous.project_id) throw new Error('field_invalid_edit_scope');
        const used = await db.query(`select 1 from public.field_sales_sessions
          where organization_id=$1 and schedule_id=$2 limit 1`, [org, input.id]);
        const visits = await db.query(`select 1 from public.field_sales_visits
          where organization_id=$1 and schedule_id=$2 limit 1`, [org, input.id]);
        const exceptions = await db.query(`select 1 from public.field_sales_schedule_exceptions
          where organization_id=$1 and schedule_id=$2 limit 1`, [org, input.id]);
        if (used.rowCount || visits.rowCount || exceptions.rowCount) throw new Error('field_history_immutable');
        expandSchedule({ series_id: input.id, schedule: input.schedule,
          region: { country_code: old.country_code, timezone: old.timezone },
          from: input.schedule.start_date, through: addCalendarDays(input.schedule.start_date, 6) });
        await db.query(`update public.field_sales_schedules set rule=$3::jsonb,revision=revision+1
          where organization_id=$1 and id=$2`, [org, input.id, JSON.stringify(input.schedule)]);
      } else if (input.operation === 'end_schedule' || input.operation === 'replace_schedule') {
        if (!old?.active) throw new Error('field_assignment_unavailable');
        const today = localParts(Date.now(), old.timezone).slice(0, 10);
        if (input.effective_date < today) throw new Error('field_history_immutable');
        const used = await db.query(`select 1 from public.field_sales_sessions
          where organization_id=$1 and schedule_id=$2 and local_date >= $3::date limit 1`, [org, input.id, input.effective_date]);
        if (used.rowCount) throw new Error('field_history_immutable');
        const rule = scheduleSchema.parse(old.rule);
        if (rule.end_date && rule.end_date < input.effective_date) throw new Error('field_assignment_unavailable');
        if (input.operation === 'replace_schedule') {
          await requireFieldScope(db, org, actor, role, input.schedule.employee_id, true);
          await requireFieldEmployee(db, org, input.schedule.employee_id);
          if (input.schedule.start_date !== input.effective_date || input.new_id === input.id)
            throw new Error('field_invalid_edit_scope');
          const project = await db.query(`select id from public.field_sales_projects
            where organization_id=$1 and id=$2 and active for share`, [org, input.schedule.project_id]);
          if (!project.rowCount) throw new Error('field_project_unavailable');
          // Validate a week in the original organization's region before splitting the rule.
          expandSchedule({ series_id: input.new_id, schedule: input.schedule,
            region: { country_code: old.country_code, timezone: old.timezone },
            from: input.effective_date, through: addCalendarDays(input.effective_date, 6) });
        }
        const deactivate = input.effective_date <= rule.start_date;
        const endDate = addCalendarDays(input.effective_date, -1);
        await db.query(`update public.field_sales_schedules set active=$3,rule=$4::jsonb,revision=revision+1
          where organization_id=$1 and id=$2`, [org, input.id, !deactivate,
          JSON.stringify(deactivate ? rule : { ...rule, end_date: endDate })]);
        if (input.operation === 'replace_schedule') {
          await db.query(`insert into public.field_sales_schedules(organization_id,id,project_id,employee_id,timezone,country_code,rule)
            values($1,$2,$3,$4,$5,$6,$7::jsonb)`, [org, input.new_id, input.schedule.project_id,
            input.schedule.employee_id, old.timezone, old.country_code, JSON.stringify(input.schedule)]);
        }
      } else if (input.operation === 'cancel_occurrence') {
        if (!old) throw new Error('field_assignment_unavailable');
        const occurrence = expandSchedule({ series_id: input.id, schedule: old.rule, region: { country_code: old.country_code, timezone: old.timezone }, from: input.date, through: input.date })[0];
        if (!old.active || !occurrence) throw new Error('field_assignment_unavailable');
        if (Date.parse(occurrence.starts_at) <= Date.now()) throw new Error('field_history_immutable');
        await db.query(`insert into public.field_sales_schedule_exceptions(organization_id,schedule_id,local_date,cancelled)
          values($1,$2,$3,true) on conflict(organization_id,schedule_id,local_date) do update set cancelled=true,replacement=null`, [org, input.id, input.date]);
        await db.query('update public.field_sales_schedules set revision=revision+1 where organization_id=$1 and id=$2', [org, input.id]);
      } else {
        await requireFieldScope(db, org, actor, role, input.schedule.employee_id, true);
        await requireFieldEmployee(db, org, input.schedule.employee_id);
        // Do not rewrite an existing series yet: editing needs explicit occurrence/future-series semantics.
        if (old && input.operation !== 'reschedule') throw new Error('field_series_edit_requires_scope');
        const region = organizationRegion((await db.query('select timezone,onboarding_state from public.organizations where id=$1 for share', [org])).rows[0]);
        if (!region.success) throw new Error('field_region_required');
        const effectiveRegion = old ? { country_code: old.country_code as string, timezone: old.timezone as string } : region.data;
        if (input.operation === 'reschedule') {
          if (!old?.active) throw new Error('field_assignment_unavailable');
          const cancelled = await db.query('select local_date from public.field_sales_schedule_exceptions where organization_id=$1 and schedule_id=$2 and local_date=$3 and cancelled', [org, input.id, input.date]);
          if (cancelled.rowCount) throw new Error('field_assignment_unavailable');
          const plan = planReschedule({ old: old.rule, replacement: input.schedule, scope: input.scope, date: input.date,
            region: effectiveRegion, now: new Date().toISOString() });
          if (plan.cancel_date) await db.query(`insert into public.field_sales_schedule_exceptions(organization_id,schedule_id,local_date,cancelled)
            values($1,$2,$3,true) on conflict(organization_id,schedule_id,local_date) do update set cancelled=true,replacement=null`, [org, input.id, plan.cancel_date]);
          await db.query('update public.field_sales_schedules set rule=$3::jsonb,active=$4,revision=revision+1 where organization_id=$1 and id=$2',
            [org, input.id, JSON.stringify(plan.old_rule), !plan.deactivate_old]);
        }
        const project = await db.query('select id from public.field_sales_projects where organization_id=$1 and id=$2 and active for share', [org, input.schedule.project_id]);
        if (!project.rowCount) throw new Error('field_project_unavailable');
        // Validate the initial occurrence window, including DST gaps/folds before persisting.
        expandSchedule({ series_id: input.id, schedule: input.schedule, region: effectiveRegion,
          from: input.schedule.start_date, through: input.schedule.start_date });
        await db.query(`insert into public.field_sales_schedules(organization_id,id,project_id,employee_id,timezone,country_code,rule)
          values($1,$2,$3,$4,$5,$6,$7::jsonb)`, [org, input.operation === 'reschedule' ? input.new_id : input.id, input.schedule.project_id, input.schedule.employee_id,
          effectiveRegion.timezone, effectiveRegion.country_code, JSON.stringify(input.schedule)]);
      }
      result = { id: input.id, revision: input.revision + 1 };
    }
    await fieldAudit(db, org, actor, 'field_sales.' + input.operation, result.id ?? org,
      { revision: result.revision ?? 0 });
    return result;
  });
}

export async function readFieldCalendar(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, from: string, through: string) {
  localDateSchema.parse(from); localDateSchema.parse(through);
  if (Date.parse(through) < Date.parse(from) || Date.parse(through) - Date.parse(from) > 92 * 86400000)
    throw new Error('field_calendar_window_too_large');
  return fieldTransaction(pool, org, actor, async (db, role) => {
    const employees = (await db.query(`select e.user_id,e.display_name,e.active from public.field_sales_employees e
      where e.organization_id=$1 and ($3 in ('admin','manager') or e.user_id=$2)
      order by e.display_name`, [org, actor, role])).rows;
    const ids = employees.map(e => e.user_id);
    const schedules = (await db.query(`select s.*,p.name as project_name,p.site_name,e.display_name as employee_name
      from public.field_sales_schedules s join public.field_sales_projects p on p.organization_id=s.organization_id and p.id=s.project_id
      join public.field_sales_employees e on e.organization_id=s.organization_id and e.user_id=s.employee_id
      where s.organization_id=$1 and p.organization_id=$1 and e.organization_id=$1 and s.employee_id=any($2::uuid[]) and s.active
      order by s.created_at limit 1001`, [org, ids])).rows;
    if (schedules.length > 1000) throw new Error('field_calendar_too_large');
    const exceptions = (await db.query(`select schedule_id,local_date::text,cancelled from public.field_sales_schedule_exceptions
      where organization_id=$1 and schedule_id=any($2::uuid[]) and local_date between $3 and $4`, [org, schedules.map(s => s.id), from, through])).rows;
    const occurrences: Array<ScheduleOccurrence & { project_name: string; site_name: string; employee_name: string; revision: number; schedule: FieldSchedule; timezone: string }> = [];
    const warnings: Array<{ schedule_id: string; reason: string }> = [];
    for (const row of schedules) {
      try {
        const expanded = expandSchedule({ series_id: row.id, schedule: row.rule as FieldSchedule,
          region: { country_code: row.country_code, timezone: row.timezone }, from, through,
          cancelled_dates: exceptions.filter(e => e.schedule_id === row.id && e.cancelled).map(e => e.local_date) });
        occurrences.push(...expanded.map(o => ({ ...o, project_name: row.project_name as string,
          site_name: row.site_name as string, employee_name: row.employee_name as string, revision: row.revision as number,
          schedule: scheduleSchema.parse(row.rule), timezone: row.timezone as string })));
      } catch { warnings.push({ schedule_id: row.id, reason: 'Review this schedule: a local time or recurrence is invalid.' }); }
    }
    const projects = (await db.query(`select p.* from public.field_sales_projects p where p.organization_id=$1
      and ($3 in ('admin','manager') or exists(select 1 from public.field_sales_schedules s where s.organization_id=$1
      and s.project_id=p.id and s.employee_id=any($2::uuid[]))) order by p.name limit 500`, [org, ids, role])).rows;
    const settings = (await db.query('select revision,enabled,retention_days,notice_text,track_breaks from public.field_sales_settings where organization_id=$1', [org])).rows[0] ?? null;
    const region = organizationRegion((await db.query('select timezone,onboarding_state from public.organizations where id=$1', [org])).rows[0]);
    return { role, employees, projects, settings, region: region.success ? region.data : null,
      assignments: schedules.map(s => ({ id: s.id as string, project_id: s.project_id as string,
        employee_id: s.employee_id as string, project_name: s.project_name as string,
        employee_name: s.employee_name as string, revision: s.revision as number,
        schedule: scheduleSchema.parse(s.rule) })),
      occurrences: occurrences.sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      overlaps: overlappingAssignments(occurrences), warnings };
  });
}
