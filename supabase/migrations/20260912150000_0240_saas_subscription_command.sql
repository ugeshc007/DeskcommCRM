-- Comando transacional do ledger SaaS. Somente service_role executa; a
-- identidade do platform admin é revalidada dentro do banco.
create or replace function public.fn_set_organization_subscription(
  p_actor uuid,
  p_organization_id uuid,
  p_idempotency_key uuid,
  p_request jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.organization_billing_events%rowtype;
  v_before public.organization_subscriptions%rowtype;
  v_after public.organization_subscriptions%rowtype;
  v_event_type text;
begin
  if p_actor is null or p_organization_id is null or p_idempotency_key is null
     or jsonb_typeof(p_request) <> 'object' then
    raise exception 'saas_subscription_invalid_arguments' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.platform_admins
     where user_id = p_actor and revoked_at is null and scope = 'full'
  ) then
    raise exception 'saas_subscription_forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'saas_subscription_org_not_found' using errcode = 'P0002';
  end if;
  if (p_request - array['plan_code','status','billing_provider','external_customer_ref',
      'external_subscription_ref','trial_ends_at','current_period_start','current_period_end',
      'cancel_at_period_end','limits']::text[]) <> '{}'::jsonb then
    raise exception 'saas_subscription_unknown_field' using errcode = '22023';
  end if;

  select * into v_existing from public.organization_billing_events
   where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
  if found then
    select * into v_after from public.organization_subscriptions where id = v_existing.subscription_id;
    return to_jsonb(v_after) || jsonb_build_object('created', false, 'replayed', true);
  end if;

  select * into v_before from public.organization_subscriptions
   where organization_id = p_organization_id for update;
  v_event_type := case when found then 'subscription_updated' else 'subscription_created' end;

  insert into public.organization_subscriptions (
    organization_id, plan_code, status, billing_provider, external_customer_ref,
    external_subscription_ref, trial_ends_at, current_period_start, current_period_end,
    cancel_at_period_end, limits
  ) values (
    p_organization_id, p_request->>'plan_code', p_request->>'status',
    coalesce(nullif(p_request->>'billing_provider',''), 'manual'),
    nullif(p_request->>'external_customer_ref',''), nullif(p_request->>'external_subscription_ref',''),
    nullif(p_request->>'trial_ends_at','')::timestamptz,
    nullif(p_request->>'current_period_start','')::timestamptz,
    nullif(p_request->>'current_period_end','')::timestamptz,
    coalesce((p_request->>'cancel_at_period_end')::boolean, false),
    coalesce(p_request->'limits', '{}'::jsonb)
  )
  on conflict (organization_id) do update set
    plan_code = excluded.plan_code, status = excluded.status,
    billing_provider = excluded.billing_provider,
    external_customer_ref = excluded.external_customer_ref,
    external_subscription_ref = excluded.external_subscription_ref,
    trial_ends_at = excluded.trial_ends_at,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    limits = excluded.limits,
    revision = public.organization_subscriptions.revision + 1
  returning * into v_after;

  insert into public.organization_billing_events (
    organization_id, subscription_id, event_type, billing_provider,
    idempotency_key, actor_user_id, previous_status, new_status, summary
  ) values (
    p_organization_id, v_after.id, v_event_type, v_after.billing_provider,
    p_idempotency_key, p_actor, v_before.status, v_after.status,
    jsonb_build_object('plan_code', v_after.plan_code, 'revision', v_after.revision)
  );
  return to_jsonb(v_after) || jsonb_build_object('created', v_event_type = 'subscription_created', 'replayed', false);
end;
$$;

revoke execute on function public.fn_set_organization_subscription(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_set_organization_subscription(uuid,uuid,uuid,jsonb)
  to service_role;
notify pgrst, 'reload schema';
