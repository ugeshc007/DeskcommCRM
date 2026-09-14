-- 0243 · O App Secret do webhook oficial deixa de exigir SSH na VPS.
--
-- É configuração da INSTALAÇÃO: um único app atende todas as organizações.
-- Por isso a tabela é singleton, server-side only, com RLS ligada, zero
-- policies e grants removidos do browser. Só o service_role alcança a linha.
-- O segredo usa a cifra existente de fn_encrypt_oauth e nunca volta à UI.

create table if not exists public.platform_meta_webhook (
  id smallint primary key default 1,
  app_secret_encrypted bytea not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint platform_meta_webhook_singleton check (id = 1)
);

comment on table public.platform_meta_webhook is
  'App Secret do webhook oficial desta instalação. Singleton server-side only; a UI recebe apenas se existe e a origem em vigor.';
comment on column public.platform_meta_webhook.app_secret_encrypted is
  'Cifrado por fn_encrypt_oauth. Nunca retornar nem decifrar para o browser.';

alter table public.platform_meta_webhook enable row level security;
revoke all on public.platform_meta_webhook from anon, authenticated;
grant select, insert, update on public.platform_meta_webhook to service_role;

drop trigger if exists trg_platform_meta_webhook_updated_at on public.platform_meta_webhook;
create trigger trg_platform_meta_webhook_updated_at
  before update on public.platform_meta_webhook
  for each row execute function public.fn_set_updated_at();
