-- Approved leave for the optional Field Sales module. No staff is enrolled or tracked by provisioning.
create or replace function public.fn_provision_field_sales_attendance_leave()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_field_sales_location_quality();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 create table if not exists public.field_sales_leave_days (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  local_date date not null,
  note text not null default '' check(length(note)<=500),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  primary key(organization_id,employee_id,local_date),
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id)
 );
 create index if not exists field_sales_leave_days_date on public.field_sales_leave_days(organization_id,local_date,employee_id);
 alter table public.field_sales_leave_days enable row level security;
 revoke all on public.field_sales_leave_days from public,anon,authenticated,service_role;
 grant select on public.field_sales_leave_days to service_role;
 drop policy if exists tenant_isolation_field_sales_leave_days_all on public.field_sales_leave_days;
 create policy tenant_isolation_field_sales_leave_days_all on public.field_sales_leave_days
  for all to authenticated using(false) with check(false);
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke execute on function public.fn_provision_field_sales_attendance_leave() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_attendance_leave() to service_role;
do $installed$ begin
 if to_regclass('public.field_sales_settings') is not null then
  perform public.fn_provision_field_sales_attendance_leave();
 end if;
end $installed$;
