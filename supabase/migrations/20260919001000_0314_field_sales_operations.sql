-- Optional Field Sales operational records; no automatic tracking activation.
create or replace function public.fn_provision_field_sales_operations()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
declare table_name text;
begin
 perform public.fn_provision_field_sales_devices();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 alter table public.field_sales_settings add column if not exists map_tile_path text;
 alter table public.field_sales_settings add column if not exists map_attribution text not null default '';
 create table if not exists public.field_sales_visits (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id uuid not null, employee_id uuid not null, project_id uuid not null,
  schedule_id uuid not null, local_date date not null, session_id uuid,
  status text not null check(status in ('traveling','arrived','completed','skipped')),
  revision integer not null default 1 check(revision>0),
  started_at timestamptz not null default now(), arrived_at timestamptz, completed_at timestamptz,
  notes text not null default '' check(length(notes)<=8000),
  next_action text not null default '' check(length(next_action)<=2000),
  next_action_at timestamptz,
  primary key(organization_id,id), unique(organization_id,schedule_id,local_date),
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id),
  foreign key(organization_id,project_id) references public.field_sales_projects(organization_id,id),
  foreign key(organization_id,schedule_id) references public.field_sales_schedules(organization_id,id),
  foreign key(organization_id,session_id) references public.field_sales_sessions(organization_id,id),
  check((status in ('completed','skipped'))=(completed_at is not null))
 );
 create table if not exists public.field_sales_visit_events (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id uuid not null, visit_id uuid not null, employee_id uuid not null,
  action text not null check(action in ('travel','arrive','complete','skip')),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key(organization_id,id),
  foreign key(organization_id,visit_id) references public.field_sales_visits(organization_id,id),
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id)
 );
 create table if not exists public.field_sales_corrections (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id uuid not null, employee_id uuid not null, session_id uuid not null,
  proposed_in timestamptz not null, proposed_out timestamptz not null,
  reason text not null check(length(reason) between 1 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id), review_note text not null default '',
  created_at timestamptz not null default now(), reviewed_at timestamptz,
  primary key(organization_id,id),
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id),
  foreign key(organization_id,session_id) references public.field_sales_sessions(organization_id,id),
  check(proposed_out>proposed_in),
  check((status='pending')=(reviewed_at is null)),
  check(reviewed_by is null or reviewed_by<>employee_id)
 );
 create unique index if not exists field_sales_pending_correction on public.field_sales_corrections(organization_id,session_id) where status='pending';
 foreach table_name in array array['field_sales_visits','field_sales_visit_events','field_sales_corrections'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',table_name);
  execute format('grant select on public.%I to service_role',table_name);
  execute format('drop policy if exists %I on public.%I','tenant_isolation_'||table_name||'_all',table_name);
  execute format('create policy %I on public.%I for all to authenticated using(false) with check(false)','tenant_isolation_'||table_name||'_all',table_name);
 end loop;
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke all on function public.fn_provision_field_sales_operations() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_operations() to service_role;
