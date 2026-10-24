-- Optional next-action lifecycle; keeps the original follow-up text and due date.
create or replace function public.fn_provision_field_sales_followups()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_field_sales_lifecycle();
 perform pg_advisory_xact_lock(hashtextextended('field-sales-module-v1',0));
 alter table public.field_sales_visits add column if not exists next_action_completed_at timestamptz;
 alter table public.field_sales_visits add column if not exists next_action_completed_by uuid references auth.users(id) on delete set null;
 create index if not exists field_sales_visits_open_action_due on public.field_sales_visits(organization_id,employee_id,next_action_at)
  where next_action<>'' and next_action_completed_at is null;
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke all on function public.fn_provision_field_sales_followups() from public,anon,authenticated;
grant execute on function public.fn_provision_field_sales_followups() to service_role;
