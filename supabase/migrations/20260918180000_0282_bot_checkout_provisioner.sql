-- Extensão opt-in: o baseline instala funções, não tabelas de um nicho.
do $rename$ begin
 if to_regprocedure('public.fn_provision_checkout_module_base()') is null then
  alter function public.fn_provision_checkout_module() rename to fn_provision_checkout_module_base;
 end if;
end $rename$;
revoke all on function public.fn_provision_checkout_module_base() from public,anon,authenticated,service_role;
create or replace function public.fn_provision_checkout_module() returns void
language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform public.fn_provision_checkout_module_base();
 alter table public.store_settings add column if not exists automated_checkout boolean not null default false;
 create unique index if not exists conversations_store_org_identity on public.conversations(organization_id,id);
 create unique index if not exists messages_store_org_identity on public.messages(organization_id,id);
 create table if not exists public.store_checkout_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  contact_id uuid not null,
  conversation_id uuid not null,
  source_message_id uuid not null,
  cart jsonb not null,
  quote jsonb not null,
  confirmation text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique(organization_id,id),
  unique(organization_id,source_message_id),
  foreign key(organization_id,contact_id) references public.contacts(organization_id,id),
  foreign key(organization_id,conversation_id) references public.conversations(organization_id,id),
  foreign key(organization_id,source_message_id) references public.messages(organization_id,id)
 );
 alter table public.store_checkout_proposals enable row level security;
 revoke all on public.store_checkout_proposals from public,anon,authenticated,service_role;
 grant select on public.store_checkout_proposals to service_role;
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke all on function public.fn_provision_checkout_module() from public,anon,authenticated;
grant execute on function public.fn_provision_checkout_module() to service_role;
-- Atualiza somente instalações que já ativaram o módulo opcional.
do $installed$ begin
 if to_regclass('public.store_settings') is not null then perform public.fn_provision_checkout_module(); end if;
end $installed$;
