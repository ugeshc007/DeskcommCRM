-- Ingestão transacional e idempotente de eventos normalizados de billing.
-- O tenant é resolvido pela referência externa já vinculada pelo platform
-- admin; jamais vem do corpo do webhook.
alter table public.organization_subscriptions
  add column if not exists provider_state_at timestamptz;

create table if not exists public.billing_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  billing_provider text not null check (billing_provider ~ '^[a-z][a-z0-9_]{0,39}$'),
  external_event_ref text not null,
  external_subscription_ref text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  subscription_id uuid references public.organization_subscriptions(id) on delete set null,
  outcome text not null check (outcome in ('processing','applied','duplicate','stale','unknown_subscription')),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  unique (billing_provider, external_event_ref)
);

alter table public.billing_webhook_receipts enable row level security;
drop policy if exists billing_webhook_receipts_platform_select on public.billing_webhook_receipts;
create policy billing_webhook_receipts_platform_select on public.billing_webhook_receipts
  for select using (public.fn_is_platform_admin());
revoke all on public.billing_webhook_receipts from public, anon, authenticated;
grant select on public.billing_webhook_receipts to authenticated;
grant all on public.billing_webhook_receipts to service_role;

create or replace function public.fn_apply_saas_provider_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_sub public.organization_subscriptions%rowtype;
  v_receipt public.billing_webhook_receipts%rowtype;
  v_provider text := p_event->>'provider';
  v_event_ref text := p_event->>'external_event_ref';
  v_sub_ref text := p_event->>'external_subscription_ref';
  v_occurred timestamptz;
  v_limits jsonb;
  v_previous_status text;
begin
  if jsonb_typeof(p_event) <> 'object'
     or (p_event - array['provider','external_event_ref','external_customer_ref','external_subscription_ref','plan_code','status','limits','occurred_at']::text[]) <> '{}'::jsonb
     or coalesce(v_provider,'') !~ '^[a-z][a-z0-9_]{0,39}$'
     or coalesce(v_event_ref,'') = '' or coalesce(v_sub_ref,'') = ''
     or p_event->>'plan_code' not in ('standard','pro','enterprise')
     or p_event->>'status' not in ('trialing','active','past_due','canceled') then
    raise exception 'saas_provider_event_invalid' using errcode='22023';
  end if;
  begin v_occurred := (p_event->>'occurred_at')::timestamptz;
  exception when others then raise exception 'saas_provider_event_invalid_time' using errcode='22023'; end;
  v_limits := p_event->'limits';

  insert into public.billing_webhook_receipts(billing_provider,external_event_ref,external_subscription_ref,outcome,occurred_at)
  values(v_provider,v_event_ref,v_sub_ref,'processing',v_occurred)
  on conflict (billing_provider,external_event_ref) do nothing
  returning * into v_receipt;
  if not found then
    return jsonb_build_object('outcome','duplicate');
  end if;

  select * into v_sub from public.organization_subscriptions
   where billing_provider=v_provider and external_subscription_ref=v_sub_ref for update;
  if not found then
    update public.billing_webhook_receipts set outcome='unknown_subscription',summary=jsonb_build_object('status',p_event->>'status') where id=v_receipt.id;
    return jsonb_build_object('outcome','unknown_subscription');
  end if;

  update public.billing_webhook_receipts set organization_id=v_sub.organization_id,subscription_id=v_sub.id where id=v_receipt.id;
  if v_sub.provider_state_at is not null and v_occurred <= v_sub.provider_state_at then
    update public.billing_webhook_receipts set outcome='stale',summary=jsonb_build_object('current_revision',v_sub.revision) where id=v_receipt.id;
    insert into public.organization_billing_events(organization_id,subscription_id,event_type,billing_provider,external_event_ref,previous_status,new_status,occurred_at,summary)
    values(v_sub.organization_id,v_sub.id,'provider_event',v_provider,v_event_ref,v_sub.status,v_sub.status,v_occurred,jsonb_build_object('outcome','stale','revision',v_sub.revision));
    return jsonb_build_object('outcome','stale','organization_id',v_sub.organization_id,'revision',v_sub.revision);
  end if;

  v_previous_status := v_sub.status;
  update public.organization_subscriptions set
    plan_code=p_event->>'plan_code', status=p_event->>'status',
    external_customer_ref=coalesce(nullif(p_event->>'external_customer_ref',''),external_customer_ref),
    limits=case when v_limits is null or v_limits='null'::jsonb then limits else v_limits end,
    provider_state_at=v_occurred, revision=revision+1
  where id=v_sub.id returning * into v_sub;
  update public.billing_webhook_receipts set outcome='applied',summary=jsonb_build_object('revision',v_sub.revision) where id=v_receipt.id;
  insert into public.organization_billing_events(organization_id,subscription_id,event_type,billing_provider,external_event_ref,previous_status,new_status,occurred_at,summary)
  values(v_sub.organization_id,v_sub.id,'provider_event',v_provider,v_event_ref,v_previous_status,v_sub.status,v_occurred,jsonb_build_object('outcome','applied','plan_code',v_sub.plan_code,'revision',v_sub.revision));
  return jsonb_build_object('outcome','applied','organization_id',v_sub.organization_id,'revision',v_sub.revision);
end; $$;

revoke execute on function public.fn_apply_saas_provider_event(jsonb) from public,anon,authenticated;
grant execute on function public.fn_apply_saas_provider_event(jsonb) to service_role;
notify pgrst, 'reload schema';
