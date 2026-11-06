-- Stable officer route identities for existing and future Field Sales installations.
create or replace function public.fn_field_sales_assign_route_style()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $assign$
begin
 if new.route_style_index is not null then return new; end if;
 perform pg_advisory_xact_lock(hashtext('field-sales-route-style'),hashtext(new.organization_id::text));
 select coalesce(max(route_style_index),-1)+1 into new.route_style_index
   from public.field_sales_employees where organization_id=new.organization_id;
 return new;
end $assign$;
revoke execute on function public.fn_field_sales_assign_route_style() from public,anon,authenticated;
grant execute on function public.fn_field_sales_assign_route_style() to service_role;
create or replace function public.fn_provision_field_sales_route_styles()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 if to_regclass('public.field_sales_employees') is null then return; end if;
 alter table public.field_sales_employees add column if not exists route_style_index integer;
 with existing as (
  select organization_id,coalesce(max(route_style_index),-1) as last_index
  from public.field_sales_employees group by organization_id
 ), missing as (
  select e.organization_id,e.user_id,
    row_number() over(partition by e.organization_id order by e.user_id)-1 as offset_index
  from public.field_sales_employees e where e.route_style_index is null
 )
 update public.field_sales_employees e
   set route_style_index=(existing.last_index+missing.offset_index+1)::integer
   from existing,missing
   where e.organization_id=missing.organization_id and e.user_id=missing.user_id
     and existing.organization_id=e.organization_id;
 alter table public.field_sales_employees alter column route_style_index set not null;
 if not exists(select 1 from pg_constraint where conrelid='public.field_sales_employees'::regclass
   and conname='field_sales_route_style_nonnegative') then
  alter table public.field_sales_employees add constraint field_sales_route_style_nonnegative
    check(route_style_index>=0);
 end if;
 create unique index if not exists field_sales_route_style_unique
   on public.field_sales_employees(organization_id,route_style_index);
 if not exists(select 1 from pg_trigger where tgrelid='public.field_sales_employees'::regclass
   and tgname='field_sales_assign_route_style') then
  create trigger field_sales_assign_route_style before insert on public.field_sales_employees
    for each row execute function public.fn_field_sales_assign_route_style();
 end if;
end $provision$;
revoke execute on function public.fn_provision_field_sales_route_styles() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_route_styles() to service_role;
do $installed$ begin
 if to_regclass('public.field_sales_employees') is not null then
  perform public.fn_provision_field_sales_route_styles();
 end if;
end $installed$;
