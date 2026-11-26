-- Optional raw GPS metadata; old mobile payloads and stored points remain valid.
create or replace function public.fn_provision_field_sales_location_quality()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_field_sales_activity_notes();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 alter table public.field_sales_locations add column if not exists device_received_at timestamptz;
 alter table public.field_sales_locations add column if not exists fix_age_ms integer;
 alter table public.field_sales_locations add column if not exists speed_m_s double precision;
 alter table public.field_sales_locations add column if not exists bearing_deg double precision;
 alter table public.field_sales_locations add column if not exists quality_flags text[] not null default '{}';
 alter table public.field_sales_locations add column if not exists device_sequence integer;
 alter table public.field_sales_settings add column if not exists moving_interval_ms integer not null default 3000 check(moving_interval_ms between 2000 and 5000);
 alter table public.field_sales_settings add column if not exists stationary_interval_ms integer not null default 30000 check(stationary_interval_ms between 10000 and 60000);
 alter table public.field_sales_settings add column if not exists position_accuracy_m integer not null default 100 check(position_accuracy_m between 10 and 500);
 alter table public.field_sales_settings add column if not exists route_accuracy_m integer not null default 30 check(route_accuracy_m between 5 and 200);
 alter table public.field_sales_settings add column if not exists plausible_speed_m_s integer not null default 55 check(plausible_speed_m_s between 1 and 100);
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke execute on function public.fn_provision_field_sales_location_quality() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_location_quality() to service_role;
do $upgrade$ begin
 if to_regclass('public.field_sales_locations') is not null then
  perform public.fn_provision_field_sales_location_quality();
 end if;
end $upgrade$;
