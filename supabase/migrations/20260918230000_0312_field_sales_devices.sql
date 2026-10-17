-- Device credentials are employee-scoped and stored only as hashes.
create or replace function public.fn_provision_field_sales_devices()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_field_sales_module();
 create table if not exists public.field_sales_devices (
  organization_id uuid not null,
  id uuid not null default gen_random_uuid(),
  employee_id uuid not null,
  label text not null check(length(label) between 1 and 100),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  primary key(organization_id,id),
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id)
 );
 alter table public.field_sales_devices enable row level security;
 revoke all on public.field_sales_devices from public,anon,authenticated,service_role;
 grant select on public.field_sales_devices to service_role;
 drop policy if exists tenant_isolation_field_sales_devices_all on public.field_sales_devices;
 create policy tenant_isolation_field_sales_devices_all on public.field_sales_devices for all to authenticated using(false) with check(false);
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke all on function public.fn_provision_field_sales_devices() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_devices() to service_role;
