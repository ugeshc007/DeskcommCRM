-- Optional Field Sales module. Installing schema never enrolls or tracks employees.
create or replace function public.fn_provision_field_sales_module()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
declare table_name text;
begin
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 create table if not exists public.field_sales_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  revision integer not null default 1 check(revision>0),
  track_breaks boolean not null default true check(track_breaks),
  retention_days integer not null check(retention_days between 1 and 365),
  notice_text text not null check(length(notice_text) between 1 and 8000),
  updated_at timestamptz not null default now()
 );
 create table if not exists public.field_sales_employees (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  active boolean not null default true,
  display_name text not null check(length(display_name) between 1 and 160),
  primary key(organization_id,user_id)
 );
 create table if not exists public.field_sales_manager_scope (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manager_id uuid not null references auth.users(id),
  employee_id uuid not null,
  primary key(organization_id,manager_id,employee_id),
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id)
 );
 create table if not exists public.field_sales_projects (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  revision integer not null default 1 check(revision>0),
  name text not null check(length(name) between 1 and 160),
  customer_id uuid,
  site_name text not null check(length(site_name) between 1 and 160),
  address text not null default '' check(length(address)<=1000),
  latitude double precision check(latitude between -90 and 90),
  longitude double precision check(longitude between -180 and 180),
  instructions text not null default '' check(length(instructions)<=4000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(organization_id,id),
  foreign key(organization_id,customer_id) references public.contacts(organization_id,id),
  check((latitude is null)=(longitude is null))
 );
 create table if not exists public.field_sales_schedules (
  organization_id uuid not null,
  id uuid not null default gen_random_uuid(),
  project_id uuid not null,
  employee_id uuid not null,
  revision integer not null default 1 check(revision>0),
  timezone text not null check(length(timezone) between 1 and 100),
  country_code text not null check(country_code ~ '^[A-Z]{2}$'),
  rule jsonb not null check(jsonb_typeof(rule)='object' and octet_length(rule::text)<=16384),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(organization_id,id),
  foreign key(organization_id,project_id) references public.field_sales_projects(organization_id,id),
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id)
 );
 create table if not exists public.field_sales_schedule_exceptions (
  organization_id uuid not null,
  schedule_id uuid not null,
  local_date date not null,
  cancelled boolean not null default true,
  replacement jsonb check(replacement is null or (jsonb_typeof(replacement)='object' and octet_length(replacement::text)<=16384)),
  primary key(organization_id,schedule_id,local_date),
  foreign key(organization_id,schedule_id) references public.field_sales_schedules(organization_id,id),
  check(cancelled=(replacement is null))
 );
 create table if not exists public.field_sales_sessions (
  organization_id uuid not null,
  id uuid not null,
  employee_id uuid not null,
  status text not null check(status in ('working','on_break','off_duty')),
  punched_in_at timestamptz not null,
  punched_out_at timestamptz,
  last_event_at timestamptz not null,
  last_sequence integer not null default 0 check(last_sequence>=0),
  created_at timestamptz not null default now(),
  primary key(organization_id,id),
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id),
  check((status='off_duty')=(punched_out_at is not null)),
  check(punched_out_at is null or punched_out_at>=punched_in_at),
  check(last_event_at>=punched_in_at)
 );
 create unique index if not exists field_sales_one_active_session on public.field_sales_sessions(organization_id,employee_id) where punched_out_at is null;
 create table if not exists public.field_sales_attendance_events (
  organization_id uuid not null,
  id uuid not null,
  session_id uuid not null,
  sequence integer not null check(sequence>=0),
  action text not null check(action in ('punch_in','break_start','break_end','punch_out')),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  primary key(organization_id,id),
  unique(organization_id,session_id,sequence),
  foreign key(organization_id,session_id) references public.field_sales_sessions(organization_id,id)
 );
 create table if not exists public.field_sales_locations (
  organization_id uuid not null,
  id uuid not null,
  session_id uuid not null,
  sequence integer not null check(sequence>=0),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy_m double precision not null check(accuracy_m between 0 and 100000),
  mock_location boolean not null,
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  primary key(organization_id,id),
  unique(organization_id,session_id,sequence),
  foreign key(organization_id,session_id) references public.field_sales_sessions(organization_id,id)
 );
 create index if not exists field_sales_location_history on public.field_sales_locations(organization_id,session_id,captured_at);
 -- GPS is not exposed through PostgREST, generic AI tokens or authenticated table reads.
 -- Server transactions revalidate current membership AND explicit employee/manager scope.
 foreach table_name in array array['field_sales_settings','field_sales_employees','field_sales_manager_scope',
   'field_sales_projects','field_sales_schedules','field_sales_schedule_exceptions','field_sales_sessions',
   'field_sales_attendance_events','field_sales_locations']
 loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',table_name);
  execute format('grant select on public.%I to service_role',table_name);
  execute format('drop policy if exists %I on public.%I','tenant_isolation_'||table_name||'_all',table_name);
  execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)','tenant_isolation_'||table_name||'_all',table_name);
 end loop;
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke all on function public.fn_provision_field_sales_module() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_module() to service_role;
