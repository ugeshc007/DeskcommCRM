-- Tombstone pseudônimo impede recriar automaticamente um contato apagado.
create or replace function public.fn_redact_native_channel_store() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 update public.channel_contact_identities set provider_user_id='redacted:'||encode(sha256(convert_to(organization_id::text||channel_session_id::text||provider_user_id,'UTF8')),'hex')
  where organization_id=new.organization_id and contact_id=new.id and provider_user_id not like 'redacted:%';
 update public.conversations set provider_conversation_id=null where organization_id=new.organization_id and contact_id=new.id and channel='messenger';
 if to_regclass('public.store_checkout_proposals') is not null then
  delete from public.store_checkout_proposals where organization_id=new.organization_id and contact_id=new.id;
 end if;
 if to_regclass('public.store_orders') is not null then
  update public.store_orders set quote='{}',payment_url=null,updated_at=now()
   where organization_id=new.organization_id and contact_id=new.id;
 end if;
 return new;
end $$;
revoke all on function public.fn_redact_native_channel_store() from public,anon,authenticated;
drop trigger if exists redact_native_channel_store on public.contacts;
create trigger redact_native_channel_store after update of is_anonymized on public.contacts
for each row when(new.is_anonymized is true) execute function public.fn_redact_native_channel_store();

create or replace function public.fn_ingest_page_message_v3(p_org uuid,p_session uuid,p_revision integer,p_sender text,p_external text,p_at timestamptz,p_text text,p_selection text,p_media jsonb,p_opt_out boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare redacted boolean;
begin
 select c.is_anonymized into redacted from public.channel_contact_identities i join public.contacts c on c.organization_id=i.organization_id and c.id=i.contact_id
  where i.organization_id=p_org and i.channel_session_id=p_session
    and i.provider_user_id in(p_sender,'redacted:'||encode(sha256(convert_to(p_org::text||p_session::text||p_sender,'UTF8')),'hex'))
  for share of c;
 if coalesce(redacted,false) then return '{"ignored":true}'::jsonb; end if;
 return public.fn_ingest_page_message_v2(p_org,p_session,p_revision,p_sender,p_external,p_at,p_text,p_selection,p_media,p_opt_out);
end $$;
revoke all on function public.fn_ingest_page_message_v3(uuid,uuid,integer,text,text,timestamptz,text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.fn_ingest_page_message_v3(uuid,uuid,integer,text,text,timestamptz,text,text,jsonb,boolean) to service_role;
