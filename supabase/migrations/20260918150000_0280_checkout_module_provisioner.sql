-- Módulo opcional: entregar a função não cria tabelas de loja para todos.
-- Instalação da instância é separada da ativação por organização.
create or replace function public.fn_provision_checkout_module()
returns void language plpgsql security definer set search_path=public,pg_temp as $provision$
begin
 perform pg_advisory_xact_lock(hashtextextended('checkout-module-provisioner-v1',0));
 create table if not exists public.store_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  active boolean not null default false,
  revision integer not null default 1 check(revision>0),
  config jsonb not null check(jsonb_typeof(config)='object' and octet_length(config::text)<=65536),
  prices_include_all_taxes boolean not null default false,
  payment_connection_id uuid,
  reservation_minutes integer not null check(reservation_minutes between 30 and 1440),
  updated_at timestamptz not null default now(),
  foreign key(organization_id,payment_connection_id) references public.integration_connections(organization_id,id)
 );
 create table if not exists public.store_products (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku text not null check(length(sku) between 1 and 100),
  revision integer not null default 1 check(revision>0),
  active boolean not null default true,
  product jsonb not null check(jsonb_typeof(product)='object' and octet_length(product::text)<=65536),
  stock_on_hand integer check(stock_on_hand>=0),
  stock_reserved integer not null default 0 check(stock_reserved>=0),
  updated_at timestamptz not null default now(),
  primary key(organization_id,sku),
  check((stock_on_hand is null and stock_reserved=0) or stock_on_hand>=stock_reserved)
 );
 create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  contact_id uuid not null,
  request_key text not null check(length(request_key) between 1 and 200),
  request_fingerprint text not null check(request_fingerprint ~ '^[a-f0-9]{64}$'),
  quote jsonb not null check(jsonb_typeof(quote)='object' and octet_length(quote::text)<=65536),
  total_cents bigint not null check(total_cents between 0 and 9007199254740991),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  status text not null check(status in ('reserved','awaiting_payment','payment_review','paid','cancelled','expired')),
  stock_state text not null default 'reserved' check(stock_state in ('reserved','consumed','released')),
  connection_id uuid not null,
  connection_revision integer not null check(connection_revision>0),
  payment_session_id text,
  payment_url text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,id),
  unique(organization_id,request_key),
  unique(connection_id,payment_session_id),
  foreign key(organization_id,contact_id) references public.contacts(organization_id,id),
  foreign key(organization_id,connection_id) references public.integration_connections(organization_id,id)
 );
 create table if not exists public.store_order_items (
  organization_id uuid not null,
  order_id uuid not null,
  sku text not null,
  quantity integer not null check(quantity>0),
  primary key(organization_id,order_id,sku),
  foreign key(organization_id,order_id) references public.store_orders(organization_id,id),
  foreign key(organization_id,sku) references public.store_products(organization_id,sku)
 );
 create table if not exists public.store_payment_events (
  organization_id uuid not null,
  connection_id uuid not null,
  event_id text not null check(length(event_id) between 1 and 100),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  order_id uuid not null,
  outcome text not null check(outcome in ('paid','expired','review','ignored')),
  created_at timestamptz not null default now(),
  primary key(organization_id,connection_id,event_id),
  foreign key(organization_id,connection_id) references public.integration_connections(organization_id,id),
  foreign key(organization_id,order_id) references public.store_orders(organization_id,id)
 );
 alter table public.store_settings enable row level security;
 alter table public.store_products enable row level security;
 alter table public.store_orders enable row level security;
 alter table public.store_order_items enable row level security;
 alter table public.store_payment_events enable row level security;
 -- Escritas exclusivamente pela transação servidor com ator e org revalidados.
 revoke all on public.store_settings,public.store_products,public.store_orders,public.store_order_items,public.store_payment_events from public,anon,authenticated,service_role;
 grant select on public.store_settings,public.store_products,public.store_orders,public.store_order_items,public.store_payment_events to service_role;
 -- O cache REST só vê as tabelas depois do commit da instalação.
 perform pg_notify('pgrst','reload schema');
end $provision$;
revoke all on function public.fn_provision_checkout_module() from public,anon,authenticated;
grant execute on function public.fn_provision_checkout_module() to service_role;
