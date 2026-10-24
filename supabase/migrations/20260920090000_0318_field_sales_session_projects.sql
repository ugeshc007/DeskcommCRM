-- Every new mobile work session is anchored to one real assigned project occurrence.
-- Existing history remains readable with nullable columns; new API writes all three values.
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
 if not exists(select 1 from pg_constraint where conrelid='public.field_sales_sessions'::regclass and conname='field_sales_sessions_assignment_complete') then
  alter table public.field_sales_sessions add constraint field_sales_sessions_assignment_complete
   check((project_id is null and schedule_id is null and local_date is null)
     or (project_id is not null and schedule_id is not null and local_date is not null));
 end if;
 create index if not exists field_sales_sessions_employee_date
  on public.field_sales_sessions(organization_id,employee_id,local_date,punched_in_at);
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke all on function public.fn_provision_field_sales_session_projects() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_session_projects() to service_role;
