-- Optional project customer roster and received-payment ledger. Provisioning never starts tracking.
create or replace function public.fn_provision_field_sales_project_customers()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
declare table_name text;
begin
 perform public.fn_provision_field_sales_flexible_shifts();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 create table if not exists public.field_sales_project_customers (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id uuid not null, project_id uuid not null,
  customer_code text check(customer_code is null or length(customer_code) between 1 and 100),
  shop_name text not null check(length(shop_name) between 1 and 200),
  address text not null default '' check(length(address)<=1000),
  balance_cents bigint,
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  revision integer not null default 1 check(revision>0),
  updated_at timestamptz not null default now(),
  primary key(organization_id,id),
  foreign key(organization_id,project_id) references public.field_sales_projects(organization_id,id)
 );
 create unique index if not exists field_sales_customer_code on public.field_sales_project_customers(organization_id,project_id,customer_code) where customer_code is not null;
 create index if not exists field_sales_customer_project on public.field_sales_project_customers(organization_id,project_id,shop_name);
 create table if not exists public.field_sales_customer_collections (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id uuid not null, project_customer_id uuid not null, project_id uuid not null,
  employee_id uuid not null, session_id uuid not null,
  captured_at timestamptz not null, received_at timestamptz not null default now(),
  amount_cents bigint check(amount_cents is null or amount_cents>0),
  balance_after_cents bigint,
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text check(void_reason is null or length(void_reason) between 5 and 500),
  primary key(organization_id,id),
  foreign key(organization_id,project_customer_id) references public.field_sales_project_customers(organization_id,id),
  foreign key(organization_id,project_id) references public.field_sales_projects(organization_id,id),
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id),
  foreign key(organization_id,session_id) references public.field_sales_sessions(organization_id,id)
 );
 alter table public.field_sales_customer_collections add column if not exists voided_at timestamptz;
 alter table public.field_sales_customer_collections add column if not exists voided_by uuid references auth.users(id);
 alter table public.field_sales_customer_collections add column if not exists void_reason text;
 create index if not exists field_sales_collection_employee_day on public.field_sales_customer_collections(organization_id,employee_id,captured_at desc);
 foreach table_name in array array['field_sales_project_customers','field_sales_customer_collections'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',table_name);
  execute format('grant select on public.%I to service_role',table_name);
  execute format('drop policy if exists %I on public.%I','tenant_isolation_'||table_name||'_all',table_name);
  execute format('create policy %I on public.%I for all to authenticated using(false) with check(false)','tenant_isolation_'||table_name||'_all',table_name);
 end loop;
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke execute on function public.fn_provision_field_sales_project_customers() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_project_customers() to service_role;
do $installed$ begin
 if to_regclass('public.field_sales_settings') is not null then
  perform public.fn_provision_field_sales_project_customers();
 end if;
end $installed$;
