-- Preserve organization deletion without allowing individual employee history deletion.
create or replace function public.fn_provision_field_sales_lifecycle()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
declare table_name text; constraint_name text;
begin
 perform public.fn_provision_field_sales_operations();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 foreach table_name in array array['field_sales_schedules','field_sales_schedule_exceptions','field_sales_sessions','field_sales_attendance_events','field_sales_locations'] loop
  constraint_name := table_name || '_organization_owner';
  if not exists(select 1 from pg_constraint where conrelid=to_regclass('public.'||table_name) and conname=constraint_name) then
   execute format('alter table public.%I add constraint %I foreign key(organization_id) references public.organizations(id) on delete cascade',table_name,constraint_name);
  end if;
 end loop;
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke all on function public.fn_provision_field_sales_lifecycle() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_lifecycle() to service_role;
