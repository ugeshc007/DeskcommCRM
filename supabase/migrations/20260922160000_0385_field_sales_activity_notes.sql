-- Optional, confirmed officer activity notes. Speech is never stored without human review.
create or replace function public.fn_provision_field_sales_activity_notes()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_field_sales_project_customers();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 create table if not exists public.field_sales_activity_notes (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id uuid not null,
  employee_id uuid not null,
  session_id uuid not null,
  project_id uuid not null,
  project_customer_id uuid,
  note text not null check(length(btrim(note)) between 1 and 1000),
  source text not null check(source in ('voice','typed')),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  primary key(organization_id,id),
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id),
  foreign key(organization_id,session_id) references public.field_sales_sessions(organization_id,id),
  foreign key(organization_id,project_id) references public.field_sales_projects(organization_id,id),
  foreign key(organization_id,project_customer_id) references public.field_sales_project_customers(organization_id,id)
 );
 create index if not exists field_sales_activity_employee_day on public.field_sales_activity_notes(organization_id,employee_id,captured_at desc);
 alter table public.field_sales_activity_notes enable row level security;
 revoke all on public.field_sales_activity_notes from public,anon,authenticated,service_role;
 grant select on public.field_sales_activity_notes to service_role;
 drop policy if exists tenant_isolation_field_sales_activity_notes_all on public.field_sales_activity_notes;
 create policy tenant_isolation_field_sales_activity_notes_all on public.field_sales_activity_notes
  for all to authenticated using(false) with check(false);
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke execute on function public.fn_provision_field_sales_activity_notes() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_activity_notes() to service_role;
do $installed$ begin
 if to_regclass('public.field_sales_settings') is not null then
  perform public.fn_provision_field_sales_activity_notes();
 end if;
end $installed$;
