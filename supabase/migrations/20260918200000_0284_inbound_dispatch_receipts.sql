-- Metadata da mensagem também é atualizada pelo worker de mídia. Recibo de
-- despacho separado: nenhum merge de metadata pode apagar a deduplicação.
create table if not exists public.inbound_dispatch_receipts (
 organization_id uuid not null references public.organizations(id),
 message_id uuid primary key references public.messages(id) on delete cascade,
 event_id uuid not null,
 created_at timestamptz not null default now()
);
alter table public.inbound_dispatch_receipts enable row level security;
revoke all on public.inbound_dispatch_receipts from public,anon,authenticated,service_role;
grant select on public.inbound_dispatch_receipts to service_role;
create or replace function public.fn_dispatch_inbound_once(p_org uuid,p_message uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.messages; eid uuid;
begin
 select * into m from public.messages where organization_id=p_org and id=p_message and direction='inbound' for update;
 if not found then raise exception 'message_unavailable'; end if;
 select event_id into eid from public.inbound_dispatch_receipts where organization_id=p_org and message_id=p_message;
 if found then return eid; end if;
 if not exists(select 1 from public.contacts where organization_id=p_org and id=m.contact_id and not is_anonymized and not is_blocked) then return null; end if;
 -- Compatibilidade com recibos emitidos pela versão anterior.
 select id into eid from public.event_log where organization_id=p_org and entity_id=p_message
  and event_type='ai_agent.dispatch_requested' and metadata->>'source'='durable_inbound' order by created_at limit 1;
 if not found then
  eid:=public.emit_event('ai_agent.dispatch_requested','message',m.id,jsonb_build_object('organization_id',p_org,'conversation_id',m.conversation_id,'contact_id',m.contact_id,'channel_session_id',m.channel_session_id,'inbound_message_id',m.id),'{"source":"durable_inbound"}',p_org);
 end if;
 insert into public.inbound_dispatch_receipts(organization_id,message_id,event_id) values(p_org,p_message,eid);
 return eid;
end $$;
revoke all on function public.fn_dispatch_inbound_once(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_dispatch_inbound_once(uuid,uuid) to service_role;
