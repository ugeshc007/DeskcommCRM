-- Fundação compartilhada de integrações (núcleo): nenhuma conta/provedor é ativado.
-- Segredos e resultados são server-only; RLS não substitui REVOKE do default ACL.
create table if not exists public.integration_connections (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 provider text not null check (provider ~ '^[a-z][a-z0-9_]{0,63}$'),
 label text not null check (char_length(label) between 1 and 120),
 revision integer not null default 1 check (revision > 0),
 active boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (organization_id,id)
);
create table if not exists public.integration_credentials (
 connection_id uuid primary key,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 revision integer not null check (revision > 0),
 ciphertext bytea not null check (octet_length(ciphertext) between 1 and 65536),
 iv bytea not null check (octet_length(iv)=12),
 tag bytea not null check (octet_length(tag)=16),
 foreign key (organization_id,connection_id) references public.integration_connections(organization_id,id) on delete cascade
);
create table if not exists public.integration_executions (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null,
 connection_revision integer not null check (connection_revision > 0),
 execution_key text not null check (char_length(execution_key) between 1 and 200),
 fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
 action text not null check (action ~ '^[a-z][a-z0-9_]{0,63}$'),
 retry_class text not null check (retry_class in ('read_only','provider_idempotent','never')),
 lease uuid not null default gen_random_uuid(),
 status text not null default 'pending' check (status in ('pending','succeeded','failed','indeterminate')),
 failure_code text check (failure_code in ('connection_unavailable','provider_rejected','invalid_output','reconciliation_required')),
 output jsonb check (octet_length(output::text)<=262144),
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 unique (organization_id,execution_key),
 foreign key (organization_id,connection_id) references public.integration_connections(organization_id,id) on delete cascade,
 check (
  (status='pending' and failure_code is null and output is null and finished_at is null) or
  (status='succeeded' and failure_code is null and output is not null and finished_at is not null) or
  (status in ('failed','indeterminate') and failure_code is not null and output is null and finished_at is not null)
 )
);
create index if not exists integration_executions_history on public.integration_executions(organization_id,created_at desc,id);
alter table public.integration_connections enable row level security;
alter table public.integration_credentials enable row level security;
alter table public.integration_executions enable row level security;
drop policy if exists tenant_isolation_integration_connections_all on public.integration_connections;
create policy tenant_isolation_integration_connections_all on public.integration_connections for select to authenticated
 using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id,'manager'));
-- Nenhuma policy de browser para cofre/ledger. Histórico expõe projeção por rota guardada.
revoke all on public.integration_connections,public.integration_credentials,public.integration_executions from public,anon,authenticated,service_role;
grant select on public.integration_connections to authenticated;
grant select,insert,update on public.integration_connections to service_role;
grant select,insert,update,delete on public.integration_credentials to service_role;
grant select on public.integration_executions to service_role;

create or replace function public.fn_integration_claim(
 p_org uuid,p_key text,p_connection uuid,p_revision integer,p_action text,p_fingerprint text,p_retry text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.integration_executions%rowtype; acquired uuid;
begin
 if p_org is null or p_connection is null or p_revision is null or p_revision<1
  or p_key is null or char_length(p_key) not between 1 and 200
  or p_action is null or p_action !~ '^[a-z][a-z0-9_]{0,63}$'
  or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
  or p_retry is null or p_retry not in ('read_only','provider_idempotent','never')
 then raise exception 'integration_invalid_input' using errcode='22023'; end if;
 perform 1 from public.integration_connections
  where organization_id=p_org and id=p_connection and revision=p_revision and active for share;
 if not found then return jsonb_build_object('kind','failed','code','connection_unavailable'); end if;
 insert into public.integration_executions(organization_id,execution_key,connection_id,connection_revision,action,fingerprint,retry_class)
 values(p_org,p_key,p_connection,p_revision,p_action,p_fingerprint,p_retry)
 on conflict(organization_id,execution_key) do nothing returning lease into acquired;
 if acquired is not null then return jsonb_build_object('kind','acquired','lease',acquired); end if;
 select * into strict v from public.integration_executions where organization_id=p_org and execution_key=p_key for update;
 if v.fingerprint<>p_fingerprint or v.connection_id<>p_connection or v.connection_revision<>p_revision
  or v.action<>p_action or v.retry_class<>p_retry then return jsonb_build_object('kind','conflict'); end if;
 if v.status='succeeded' then return jsonb_build_object('kind','completed','output',v.output); end if;
 if v.status='failed' then return jsonb_build_object('kind','failed','code',v.failure_code); end if;
 if v.status='indeterminate' then return jsonb_build_object('kind','indeterminate'); end if;
 -- Não expira/reclama lease: timeout não prova que o efeito externo não ocorreu.
 return jsonb_build_object('kind','busy');
end; $$;
revoke all on function public.fn_integration_claim(uuid,text,uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.fn_integration_claim(uuid,text,uuid,integer,text,text,text) to service_role;

create or replace function public.fn_integration_finish(p_org uuid,p_key text,p_lease uuid,p_status text,p_output jsonb,p_code text)
 returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_org is null or p_key is null or p_lease is null or p_status is null
  or p_status not in ('succeeded','failed','indeterminate')
  or (p_status='succeeded' and (p_output is null or p_code is not null))
  or (p_status in ('failed','indeterminate') and (p_output is not null or p_code is null
    or p_code not in ('connection_unavailable','provider_rejected','invalid_output','reconciliation_required')))
 then raise exception 'integration_invalid_result' using errcode='22023'; end if;
 update public.integration_executions set status=p_status,output=p_output,failure_code=p_code,finished_at=now()
 where organization_id=p_org and execution_key=p_key and lease=p_lease and status='pending';
 if not found then raise exception 'integration_execution_conflict' using errcode='40001'; end if;
end; $$;
revoke all on function public.fn_integration_finish(uuid,text,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.fn_integration_finish(uuid,text,uuid,text,jsonb,text) to service_role;
notify pgrst,'reload schema';
