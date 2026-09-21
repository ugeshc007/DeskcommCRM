-- Forward-fix 0381: keep the migration chain's final provisioners identical to
-- the self-host baseline, whose assignment constraint has one final definition.
create or replace function public.fn_provision_field_sales_session_projects()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_field_sales_photos();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 alter table public.field_sales_sessions add column if not exists project_id uuid;
 alter table public.field_sales_sessions add column if not exists schedule_id uuid;
 alter table public.field_sales_sessions add column if not exists local_date date;
 if not exists(select 1 from pg_constraint where conrelid='public.field_sales_sessions'::regclass and conname='field_sales_sessions_project') then
  alter table public.field_sales_sessions add constraint field_sales_sessions_project
   foreign key(organization_id,project_id) references public.field_sales_projects(organization_id,id);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.field_sales_sessions'::regclass and conname='field_sales_sessions_schedule') then
  alter table public.field_sales_sessions add constraint field_sales_sessions_schedule
   foreign key(organization_id,schedule_id) references public.field_sales_schedules(organization_id,id);
 end if;
 -- Final vocabulary (0381): a shift may begin before project selection.
 alter table public.field_sales_sessions drop constraint if exists field_sales_sessions_assignment_complete;
 alter table public.field_sales_sessions add constraint field_sales_sessions_assignment_complete
  check((project_id is null and schedule_id is null)
    or (project_id is not null and local_date is not null));
 create index if not exists field_sales_sessions_employee_date
  on public.field_sales_sessions(organization_id,employee_id,local_date,punched_in_at);
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke all on function public.fn_provision_field_sales_session_projects() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_session_projects() to service_role;

create or replace function public.fn_provision_field_sales_flexible_shifts()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_field_sales_session_projects();
 perform public.fn_provision_field_sales_pairing();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 alter table public.field_sales_devices alter column expires_at drop not null;
 update public.field_sales_devices set expires_at=null
  where token_hash is not null and revoked_at is null;
 -- The assignment constraint is rebuilt once, with the final vocabulary,
 -- by fn_provision_field_sales_session_projects above.
 alter table public.field_sales_sessions drop constraint if exists field_sales_sessions_schedule_requires_project;
 alter table public.field_sales_sessions add constraint field_sales_sessions_schedule_requires_project
  check(schedule_id is null or project_id is not null);
 alter table public.field_sales_attendance_events drop constraint if exists field_sales_attendance_events_action_check;
 alter table public.field_sales_attendance_events add constraint field_sales_attendance_events_action_check
  check(action in ('punch_in','select_project','break_start','break_end','punch_out'));
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke execute on function public.fn_provision_field_sales_flexible_shifts() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_flexible_shifts() to service_role;

do $upgrade$
begin
 if to_regclass('public.field_sales_sessions') is not null then
  perform public.fn_provision_field_sales_flexible_shifts();
 end if;
end $upgrade$;
