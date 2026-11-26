-- Controle de conexões: escrita apenas por RPC server-only, ator atual revalidado.
-- Renumerada antes da publicação para não colidir com a 0276 do upstream.
alter table public.integration_connections add column if not exists auth_kind text not null default 'api_key' check(auth_kind in ('api_key','oauth'));
alter table public.integration_connections add column if not exists validated_at timestamptz;
alter table public.integration_connections add column if not exists failure_code text check(failure_code in ('validation_failed','reconnect_required'));
create table if not exists public.integration_oauth_states (
 state_hash text primary key check(state_hash ~ '^[a-f0-9]{64}$'),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null,
 actor_user_id uuid not null references auth.users(id) on delete cascade,
 revision integer not null check(revision>0),
 browser_hash text not null check(browser_hash ~ '^[a-f0-9]{64}$'),
 verifier jsonb not null,
 expires_at timestamptz not null,
 foreign key(organization_id,connection_id) references public.integration_connections(organization_id,id) on delete cascade
);
alter table public.integration_oauth_states enable row level security;
revoke all on public.integration_oauth_states from public,anon,authenticated,service_role;
grant select,insert,delete on public.integration_oauth_states to service_role;

create or replace function public.fn_integration_manage(
 p_org uuid,p_actor uuid,p_id uuid,p_revision integer,p_provider text,p_label text,p_auth_kind text,p_op text,
 p_ciphertext bytea default null,p_iv bytea default null,p_tag bytea default null,p_verified boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.integration_connections%rowtype;
begin
 if p_actor is null or not exists(select 1 from public.user_organizations where organization_id=p_org and user_id=p_actor and role='admin' and revoked_at is null and accepted_at is not null)
 then raise exception 'integration_forbidden' using errcode='42501'; end if;
 if p_id is null or p_org is null or p_revision is null or p_revision<0 or p_op is null or p_op not in ('save','disconnect','test')
 then raise exception 'integration_invalid_input' using errcode='22023'; end if;
 if p_revision=0 then
  if p_op<>'save' then raise exception 'integration_conflict' using errcode='40001'; end if;
  insert into public.integration_connections(id,organization_id,provider,label,auth_kind)
   values(p_id,p_org,p_provider,p_label,p_auth_kind) on conflict(id) do nothing;
  if not found then raise exception 'integration_conflict' using errcode='40001'; end if;
 end if;
 select * into c from public.integration_connections where organization_id=p_org and id=p_id for update;
 if not found or (p_revision<>0 and c.revision<>p_revision) then raise exception 'integration_conflict' using errcode='40001'; end if;
 if p_op='save' then
  if p_provider is distinct from c.provider or p_auth_kind is distinct from c.auth_kind or p_label is null or char_length(trim(p_label)) not between 1 and 120
   then raise exception 'integration_invalid_input' using errcode='22023'; end if;
  if p_ciphertext is null and (c.auth_kind<>'oauth' or p_revision<>0 or p_verified)
   then raise exception 'integration_missing_credential' using errcode='22023'; end if;
  update public.integration_connections set label=p_label, revision=case when p_revision=0 then 1 else revision+1 end,
   active=coalesce(p_verified,false),validated_at=case when p_verified then now() else null end,failure_code=null,updated_at=now()
   where organization_id=p_org and id=p_id returning * into c;
  if p_ciphertext is not null then
   insert into public.integration_credentials(organization_id,connection_id,revision,ciphertext,iv,tag)
    values(p_org,p_id,c.revision,p_ciphertext,p_iv,p_tag)
   on conflict(connection_id) do update set revision=excluded.revision,ciphertext=excluded.ciphertext,iv=excluded.iv,tag=excluded.tag
    where integration_credentials.organization_id=p_org;
  end if;
 elsif p_op='disconnect' then
  delete from public.integration_credentials where organization_id=p_org and connection_id=p_id;
  delete from public.integration_oauth_states where organization_id=p_org and connection_id=p_id;
  update public.integration_connections set active=false,revision=revision+1,validated_at=null,failure_code='reconnect_required',updated_at=now()
   where organization_id=p_org and id=p_id returning * into c;
 else
  if not exists(select 1 from public.integration_credentials where organization_id=p_org and connection_id=p_id and revision=c.revision)
   then raise exception 'integration_missing_credential' using errcode='22023'; end if;
  update public.integration_connections set active=coalesce(p_verified,false),validated_at=case when p_verified then now() else null end,
   failure_code=case when p_verified then null else 'validation_failed' end,updated_at=now()
   where organization_id=p_org and id=p_id returning * into c;
 end if;
 return to_jsonb(c);
end; $$;
revoke all on function public.fn_integration_manage(uuid,uuid,uuid,integer,text,text,text,text,bytea,bytea,bytea,boolean) from public,anon,authenticated;
grant execute on function public.fn_integration_manage(uuid,uuid,uuid,integer,text,text,text,text,bytea,bytea,bytea,boolean) to service_role;
-- API/worker não podem contornar CAS por UPDATE direto.
revoke insert,update on public.integration_connections from service_role;
revoke insert,update,delete on public.integration_credentials from service_role;

create or replace function public.fn_integration_oauth_consume(p_state text,p_browser text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.integration_oauth_states%rowtype;
begin
 delete from public.integration_oauth_states where state_hash=p_state and browser_hash=p_browser and expires_at>now() returning * into s;
 if not found then return null; end if;
 if not exists(select 1 from public.user_organizations where organization_id=s.organization_id and user_id=s.actor_user_id and role='admin' and revoked_at is null and accepted_at is not null)
  or not exists(select 1 from public.integration_connections where organization_id=s.organization_id and id=s.connection_id and revision=s.revision and auth_kind='oauth')
 then return null; end if;
 return to_jsonb(s);
end; $$;
revoke all on function public.fn_integration_oauth_consume(text,text) from public,anon,authenticated;
grant execute on function public.fn_integration_oauth_consume(text,text) to service_role;
notify pgrst,'reload schema';
