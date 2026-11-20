-- Optional Field Sales: an employee can clock in before choosing a project.
-- Existing sessions and audit events are retained. A paired device stays valid
-- until explicit revocation; pending pairing codes still expire after 5 minutes.
create or replace function public.fn_provision_field_sales_flexible_shifts()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_field_sales_session_projects();
 perform public.fn_provision_field_sales_pairing();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 alter table public.field_sales_devices alter column expires_at drop not null;
 update public.field_sales_devices set expires_at=null
  where token_hash is not null and revoked_at is null;
 alter table public.field_sales_sessions drop constraint if exists field_sales_sessions_assignment_complete;
 alter table public.field_sales_sessions add constraint field_sales_sessions_assignment_complete
  check((project_id is null and schedule_id is null)
    or (project_id is not null and local_date is not null));
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
