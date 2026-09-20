-- Optional Field Sales: remove only raw GPS older than each organization's explicit policy.
create or replace function public.fn_expurgar_field_sales_locations(p_limite integer default 1000)
returns integer language plpgsql security definer set search_path=public,pg_temp as $retention$
declare total integer;
begin
 if to_regclass('public.field_sales_locations') is null then return 0; end if;
 with expired as (
  select l.organization_id,l.id from public.field_sales_locations l
  join public.field_sales_settings s on s.organization_id=l.organization_id
  where l.captured_at < now()-make_interval(days=>s.retention_days)
  order by l.captured_at,l.organization_id,l.id
  limit greatest(1,least(coalesce(p_limite,1000),10000))
  for update of l skip locked
 ), removed as (
  delete from public.field_sales_locations l using expired e
  where l.organization_id=e.organization_id and l.id=e.id returning l.organization_id
 ), counts as (
  select organization_id,count(*)::integer n from removed group by organization_id
 ), audited as (
  insert into public.api_audit_log(organization_id,action,resource_type,resource_id,metadata,bypassed_rls)
  select organization_id,'field_sales.location_retention','field_sales',organization_id,
    jsonb_build_object('deleted',n),true from counts returning id
 )
 select coalesce(sum(n),0)::integer into total from counts;
 return total;
end $retention$;
revoke all on function public.fn_expurgar_field_sales_locations(integer) from public,anon,authenticated;
grant execute on function public.fn_expurgar_field_sales_locations(integer) to service_role;
