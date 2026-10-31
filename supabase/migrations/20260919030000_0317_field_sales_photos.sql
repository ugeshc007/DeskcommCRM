-- Private visit photos live with their owning visit; no public URLs or storage-orphan lifecycle.
create or replace function public.fn_provision_field_sales_photos()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_field_sales_followups();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 create table if not exists public.field_sales_photos (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  id uuid not null, visit_id uuid not null, employee_id uuid not null,
  captured_at timestamptz not null, received_at timestamptz not null default now(),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  image bytea not null check(octet_length(image) between 1 and 1048576),
  primary key(organization_id,id),
  foreign key(organization_id,visit_id) references public.field_sales_visits(organization_id,id) on delete cascade,
  foreign key(organization_id,employee_id) references public.field_sales_employees(organization_id,user_id) on delete cascade
 );
 create index if not exists field_sales_photos_visit on public.field_sales_photos(organization_id,visit_id);
 alter table public.field_sales_photos enable row level security;
 revoke all on public.field_sales_photos from public,anon,authenticated,service_role;
 grant select on public.field_sales_photos to service_role;
 drop policy if exists tenant_isolation_field_sales_photos_all on public.field_sales_photos;
 create policy tenant_isolation_field_sales_photos_all on public.field_sales_photos for all to authenticated using(false) with check(false);
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke all on function public.fn_provision_field_sales_photos() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_photos() to service_role;
