-- Identidade e autoridade de canal são núcleo. PSID nunca vira telefone.
alter table public.channel_sessions add column if not exists provider_account_id text;
alter table public.channel_sessions add column if not exists integration_connection_id uuid;
alter table public.channel_sessions add column if not exists credential_revision integer;
alter table public.channel_sessions add column if not exists webhook_verified_at timestamptz;
alter table public.channel_sessions add column if not exists webhook_received_at timestamptz;
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_check;
alter table public.channel_sessions add constraint channel_sessions_provider_check check(provider in ('waha','meta_cloud','zernio','wacalls','messenger'));
alter table public.channel_sessions drop constraint if exists channel_sessions_provider_ref_check;
alter table public.channel_sessions add constraint channel_sessions_provider_ref_check check(
 (provider='waha' and waha_session_name is not null) or
 (provider='meta_cloud' and meta_phone_number_id is not null) or
 (provider='zernio' and zernio_account_id is not null) or
 (provider='wacalls' and wacalls_session_id is not null) or
 (provider='messenger' and provider_account_id is not null and provider_account_id ~ '^[0-9]{1,64}$' and integration_connection_id is not null and credential_revision is not null and credential_revision>0));
alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check check(channel in ('whatsapp','messenger'));
create unique index if not exists channel_sessions_org_id_identity on public.channel_sessions(organization_id,id);
create unique index if not exists contacts_org_id_identity on public.contacts(organization_id,id);
create unique index if not exists native_page_exclusive on public.channel_sessions(provider,provider_account_id) where provider='messenger';
create unique index if not exists native_connection_exclusive on public.channel_sessions(integration_connection_id) where integration_connection_id is not null;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='channel_integration_owner') then
  alter table public.channel_sessions add constraint channel_integration_owner foreign key(organization_id,integration_connection_id) references public.integration_connections(organization_id,id);
 end if;
end $$;

create table if not exists public.channel_contact_identities(
 organization_id uuid not null references public.organizations(id) on delete cascade,
 channel_session_id uuid not null,
 provider_user_id text not null check(length(provider_user_id) between 1 and 128),
 contact_id uuid not null,
 primary key(organization_id,channel_session_id,provider_user_id),
 foreign key(organization_id,channel_session_id) references public.channel_sessions(organization_id,id),
 foreign key(organization_id,contact_id) references public.contacts(organization_id,id)
);
alter table public.channel_contact_identities enable row level security;
revoke all on public.channel_contact_identities from public,anon,authenticated,service_role;
grant select on public.channel_contact_identities to service_role;

create or replace function public.fn_guard_native_channel_binding() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if current_setting('role',true) in ('anon','authenticated') and
  (new.provider='messenger' or (tg_op='UPDATE' and old.provider='messenger')) then
  raise exception 'native_channel_server_only' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.fn_guard_native_channel_binding() from public,anon,authenticated;
drop trigger if exists guard_native_channel_binding on public.channel_sessions;
create trigger guard_native_channel_binding before insert or update on public.channel_sessions for each row execute function public.fn_guard_native_channel_binding();

create or replace function public.fn_bind_page_channel(p_org uuid,p_actor uuid,p_connection uuid,p_revision integer,p_page text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.integration_connections; s public.channel_sessions; result uuid;
begin
 if not exists(select 1 from public.user_organizations where organization_id=p_org and user_id=p_actor and role='admin' and accepted_at is not null and revoked_at is null)
 then raise exception 'channel_forbidden' using errcode='42501'; end if;
 select * into c from public.integration_connections where organization_id=p_org and id=p_connection for update;
 if not found or c.provider<>'messenger' or not c.active or c.revision<>p_revision or p_page is null or p_page !~ '^[0-9]{1,64}$'
 then raise exception 'channel_connection_unavailable' using errcode='40001'; end if;
 select * into s from public.channel_sessions where integration_connection_id=p_connection for update;
 if found then
  if s.organization_id<>p_org or s.provider_account_id<>p_page then raise exception 'channel_identity_conflict' using errcode='23505'; end if;
  if s.credential_revision=p_revision and s.archived_at is null then return s.id; end if;
  update public.channel_sessions set credential_revision=p_revision,status='STARTING',archived_at=null,webhook_verified_at=null,webhook_received_at=null where organization_id=p_org and id=s.id;
  return s.id;
 end if;
 insert into public.channel_sessions(organization_id,provider,provider_account_id,integration_connection_id,credential_revision,display_name,status,webhook_secret_encrypted,created_by,metadata)
 values(p_org,'messenger',p_page,p_connection,p_revision,c.label,'STARTING','\x'::bytea,p_actor,'{"ai_gate":"allowlist"}'::jsonb) returning id into result;
 return result;
end $$;
revoke all on function public.fn_bind_page_channel(uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.fn_bind_page_channel(uuid,uuid,uuid,integer,text) to service_role;

-- Toda rotação/desconexão suspende a sessão; reativar exige o administrador.
create or replace function public.fn_invalidate_connection_channel() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.revision is distinct from old.revision or not new.active then
  update public.channel_sessions set status='STOPPED',status_reason='Connection changed; activate and verify again',webhook_verified_at=null
   where organization_id=new.organization_id and integration_connection_id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.fn_invalidate_connection_channel() from public,anon,authenticated;
drop trigger if exists invalidate_connection_channel on public.integration_connections;
create trigger invalidate_connection_channel after update on public.integration_connections for each row execute function public.fn_invalidate_connection_channel();

-- Uma transação guarda identidade, conversa e mensagem; advisory lock evita duplicar
-- contato na primeira entrega concorrente. Reentrega não move a janela nem o unread.
create or replace function public.fn_ingest_page_message(p_org uuid,p_session uuid,p_revision integer,p_sender text,p_external text,p_at timestamptz,p_text text,p_selection text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.channel_sessions; contact uuid; conversation uuid; message uuid; duplicate boolean:=false;
begin
 -- Mesmo ordenamento de bind/rotate: conexão antes da sessão. Evita upgrade
 -- SHARE->UPDATE concorrente e inversão com o trigger de rotação.
 perform 1 from public.integration_connections ic
 where ic.organization_id=p_org and ic.id=(select integration_connection_id from public.channel_sessions where organization_id=p_org and id=p_session)
 for share;
 select cs.* into s from public.channel_sessions cs join public.integration_connections ic on ic.organization_id=cs.organization_id and ic.id=cs.integration_connection_id
 where cs.organization_id=p_org and cs.id=p_session and cs.provider='messenger' and cs.archived_at is null and cs.credential_revision=p_revision
 and ic.revision=p_revision and ic.active for update of cs;
 if not found then raise exception 'channel_unavailable' using errcode='42501'; end if;
 if p_sender is null or p_sender !~ '^[0-9]{1,64}$' or p_sender=s.provider_account_id or p_external is null or length(p_external) not between 1 and 512
 or p_at is null or p_at>now()+interval '5 minutes' or length(coalesce(p_text,''))>20000 or length(coalesce(p_selection,''))>2000 then
  raise exception 'invalid_message' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||p_session::text||p_sender,0));
 select contact_id into contact from public.channel_contact_identities where organization_id=p_org and channel_session_id=p_session and provider_user_id=p_sender;
 if not found then
  insert into public.contacts(organization_id,display_name,source) values(p_org,'Messenger customer','messenger') returning id into contact;
  insert into public.channel_contact_identities values(p_org,p_session,p_sender,contact);
 end if;
 select id into conversation from public.conversations where organization_id=p_org and channel_session_id=p_session and contact_id=contact and provider_conversation_id=p_sender order by created_at desc limit 1;
 if not found then
  insert into public.conversations(organization_id,contact_id,channel_session_id,channel,provider_conversation_id,status)
  values(p_org,contact,p_session,'messenger',p_sender,'open') returning id into conversation;
 end if;
 select id into message from public.messages where organization_id=p_org and external_id='page:'||s.provider_account_id||':'||p_external;
 if found then
  if not exists(select 1 from public.messages where organization_id=p_org and id=message and conversation_id=conversation) then raise exception 'message_identity_conflict' using errcode='23505'; end if;
  duplicate:=true;
 else
  insert into public.messages(organization_id,conversation_id,channel_session_id,contact_id,external_id,type,direction,status,body,sent_at,metadata)
  values(p_org,conversation,p_session,contact,'page:'||s.provider_account_id||':'||p_external,'text','inbound','received',p_text,p_at,
   jsonb_build_object('selection',p_selection,'provider_message_id',p_external)) returning id into message;
  update public.conversations set last_inbound_at=greatest(last_inbound_at,p_at),last_message_at=greatest(last_message_at,p_at),
   last_message_preview=case when last_message_at is null or last_message_at<=p_at then left(p_text,200) else last_message_preview end,
   unread_count_for_assignee=unread_count_for_assignee+1 where organization_id=p_org and id=conversation;
 end if;
 update public.channel_sessions set webhook_received_at=now(),status='WORKING',status_reason=null where organization_id=p_org and id=p_session;
 return jsonb_build_object('contact_id',contact,'conversation_id',conversation,'message_id',message,'duplicate',duplicate);
end $$;
revoke all on function public.fn_ingest_page_message(uuid,uuid,integer,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.fn_ingest_page_message(uuid,uuid,integer,text,text,timestamptz,text,text) to service_role;
