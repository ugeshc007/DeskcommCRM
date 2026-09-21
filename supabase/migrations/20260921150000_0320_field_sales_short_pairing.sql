-- Optional Field Sales: a six-digit value is only a short-lived pairing code.
-- The long-lived device bearer remains 256-bit and is never derived from the code.
create or replace function public.fn_provision_field_sales_pairing()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_field_sales_devices();
 alter table public.field_sales_devices alter column token_hash drop not null;
 alter table public.field_sales_devices add column if not exists pairing_code_hash text;
 alter table public.field_sales_devices add column if not exists pairing_expires_at timestamptz;
 create unique index if not exists field_sales_devices_pairing_code_hash_key
   on public.field_sales_devices(pairing_code_hash) where pairing_code_hash is not null;
 revoke all on public.field_sales_devices from public,anon,authenticated,service_role;
 grant select on public.field_sales_devices to service_role;
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke execute on function public.fn_provision_field_sales_pairing() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_pairing() to service_role;

-- Existing optional installations are upgraded; a fresh installation stays
-- unprovisioned until its platform administrator installs Field Sales.
do $upgrade$
begin
 if to_regclass('public.field_sales_devices') is not null then
   perform public.fn_provision_field_sales_pairing();
 end if;
end $upgrade$;
