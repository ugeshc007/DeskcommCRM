-- Recibo + mídia + trabalho durável no mesmo commit. Não executa HTTP no banco.
create or replace function public.fn_ingest_page_message_v2(p_org uuid,p_session uuid,p_revision integer,p_sender text,p_external text,p_at timestamptz,p_text text,p_selection text,p_media jsonb,p_opt_out boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; mid uuid; cid uuid;
begin
 if p_media is not null and (p_media->>'kind' not in ('image','video','audio','document') or p_media->>'url' is null or length(p_media->>'url')>8000 or p_media->>'url' !~ '^https://') then raise exception 'invalid_media'; end if;
 r:=public.fn_ingest_page_message(p_org,p_session,p_revision,p_sender,p_external,p_at,p_text,p_selection);
 mid:=(r->>'message_id')::uuid; cid:=(r->>'contact_id')::uuid;
 if coalesce((r->>'duplicate')::boolean,false) then return r; end if;
 if exists(select 1 from public.contacts where organization_id=p_org and id=cid and is_anonymized) then raise exception 'contact_unavailable'; end if;
 if p_opt_out then
  update public.contacts set is_blocked=true,blocked_reason='stop_keyword',blocked_at=now() where organization_id=p_org and id=cid;
 end if;
 if p_media is not null then
  update public.messages set type=p_media->>'kind',media_url=p_media->>'url',metadata=metadata||'{"media_status":"pending"}'::jsonb
   where organization_id=p_org and id=mid;
  perform public.emit_event('media.persist_requested','message',mid,jsonb_build_object('message_id',mid),'{}',p_org);
 end if;
 perform public.emit_event('channel.inbound_postprocess','message',mid,jsonb_build_object('message_id',mid),'{}',p_org);
 return r;
end $$;
revoke all on function public.fn_ingest_page_message_v2(uuid,uuid,integer,text,text,timestamptz,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.fn_ingest_page_message_v2(uuid,uuid,integer,text,text,timestamptz,text,text,jsonb,boolean) to service_role;

-- Um evento de despacho por mensagem, mesmo se o worker morrer após o commit.
create or replace function public.fn_dispatch_inbound_once(p_org uuid,p_message uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare m public.messages; eid uuid;
begin
 select * into m from public.messages where organization_id=p_org and id=p_message and direction='inbound' for update;
 if not found then raise exception 'message_unavailable'; end if;
 if m.metadata ? 'native_dispatch_event_id' then return (m.metadata->>'native_dispatch_event_id')::uuid; end if;
 if not exists(select 1 from public.contacts where organization_id=p_org and id=m.contact_id and not is_anonymized and not is_blocked) then return null; end if;
 eid:=public.emit_event('ai_agent.dispatch_requested','message',m.id,jsonb_build_object('organization_id',p_org,'conversation_id',m.conversation_id,'contact_id',m.contact_id,'channel_session_id',m.channel_session_id,'inbound_message_id',m.id),'{"source":"durable_inbound"}',p_org);
 update public.messages set metadata=coalesce(metadata,'{}')||jsonb_build_object('native_dispatch_event_id',eid) where organization_id=p_org and id=m.id;
 return eid;
end $$;
revoke all on function public.fn_dispatch_inbound_once(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fn_dispatch_inbound_once(uuid,uuid) to service_role;
