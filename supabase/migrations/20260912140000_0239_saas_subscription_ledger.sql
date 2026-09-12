-- Ledger provider-neutral para o piloto SaaS gerenciado.
--
-- Ausência de linha = organização não gerenciada (self-host). Nenhum clone
-- existente ganha cobrança, limite ou bloqueio ao aplicar esta migration.
-- Estado de billing também NÃO suspende organização automaticamente: essa
-- decisão continua na ação explícita e auditada de platform admin.

create table if not exists public.organization_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_code text not null,
  status text not null,
  billing_provider text not null default 'manual',
  external_customer_ref text,
  external_subscription_ref text,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  limits jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organization_subscriptions_org_unique unique (organization_id),
  constraint organization_subscriptions_plan_check
    check (plan_code in ('standard', 'pro', 'enterprise')),
  constraint organization_subscriptions_status_check
    check (status in ('trialing', 'active', 'past_due', 'canceled')),
  constraint organization_subscriptions_provider_check
    check (billing_provider ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint organization_subscriptions_period_check
    check (current_period_end is null or current_period_start is null
           or current_period_end >= current_period_start),
  constraint organization_subscriptions_revision_check check (revision > 0),
  constraint organization_subscriptions_limits_check check (
    jsonb_typeof(limits) = 'object'
    and (limits - array['members', 'channels', 'monthly_ai_cents']::text[]) = '{}'::jsonb
    and (not (limits ? 'members') or (
      jsonb_typeof(limits->'members') = 'number'
      and (limits->>'members')::numeric >= 0
      and (limits->>'members')::numeric = trunc((limits->>'members')::numeric)
    ))
    and (not (limits ? 'channels') or (
      jsonb_typeof(limits->'channels') = 'number'
      and (limits->>'channels')::numeric >= 0
      and (limits->>'channels')::numeric = trunc((limits->>'channels')::numeric)
    ))
    and (not (limits ? 'monthly_ai_cents') or (
      jsonb_typeof(limits->'monthly_ai_cents') = 'number'
      and (limits->>'monthly_ai_cents')::numeric >= 0
      and (limits->>'monthly_ai_cents')::numeric = trunc((limits->>'monthly_ai_cents')::numeric)
    ))
  )
);

create unique index if not exists organization_subscriptions_external_ref_idx
  on public.organization_subscriptions (billing_provider, external_subscription_ref)
  where external_subscription_ref is not null;

create index if not exists organization_subscriptions_status_period_idx
  on public.organization_subscriptions (status, current_period_end)
  where status in ('trialing', 'past_due', 'canceled');

create table if not exists public.organization_billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription_id uuid not null references public.organization_subscriptions(id) on delete restrict,
  event_type text not null,
  billing_provider text not null,
  external_event_ref text,
  idempotency_key uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  previous_status text,
  new_status text,
  summary jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),

  constraint organization_billing_events_type_check
    check (event_type in ('subscription_created', 'subscription_updated', 'provider_event')),
  constraint organization_billing_events_provider_check
    check (billing_provider ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint organization_billing_events_previous_status_check
    check (previous_status is null or previous_status in ('trialing', 'active', 'past_due', 'canceled')),
  constraint organization_billing_events_new_status_check
    check (new_status is null or new_status in ('trialing', 'active', 'past_due', 'canceled')),
  constraint organization_billing_events_summary_check check (jsonb_typeof(summary) = 'object')
);

create unique index if not exists organization_billing_events_external_idx
  on public.organization_billing_events (billing_provider, external_event_ref)
  where external_event_ref is not null;

create unique index if not exists organization_billing_events_idempotency_idx
  on public.organization_billing_events (organization_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists organization_billing_events_org_time_idx
  on public.organization_billing_events (organization_id, occurred_at desc, id desc);

alter table public.organization_subscriptions enable row level security;
alter table public.organization_billing_events enable row level security;

drop policy if exists organization_subscriptions_admin_select on public.organization_subscriptions;
create policy organization_subscriptions_admin_select on public.organization_subscriptions
  for select using (
    public.fn_is_platform_admin()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
    )
  );

drop policy if exists organization_billing_events_admin_select on public.organization_billing_events;
create policy organization_billing_events_admin_select on public.organization_billing_events
  for select using (
    public.fn_is_platform_admin()
    or (
      organization_id in (select public.fn_user_org_ids())
      and public.fn_role_at_least(organization_id, 'admin')
    )
  );

revoke all on public.organization_subscriptions from public, anon, authenticated;
revoke all on public.organization_billing_events from public, anon, authenticated;
grant select on public.organization_subscriptions to authenticated;
grant select on public.organization_billing_events to authenticated;
grant all on public.organization_subscriptions to service_role;
grant all on public.organization_billing_events to service_role;

drop trigger if exists trg_organization_subscriptions_updated_at on public.organization_subscriptions;
create trigger trg_organization_subscriptions_updated_at
  before update on public.organization_subscriptions
  for each row execute function public.fn_set_updated_at();

comment on table public.organization_subscriptions is
  'Assinatura provider-neutral de uma organização gerenciada. Ausência de linha = self-host/unmanaged. Status de billing não suspende a organização automaticamente.';
comment on column public.organization_subscriptions.limits is
  'Limites comerciais opcionais: members, channels, monthly_ai_cents. Chave ausente = não aplicar aquele limite.';
comment on table public.organization_billing_events is
  'Histórico append-only de billing. Guarda resumo mínimo; nunca payload completo, cartão ou segredo do provedor.';

notify pgrst, 'reload schema';
