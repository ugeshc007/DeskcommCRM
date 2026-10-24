-- Sessão tipada pertence ao enrollment; nenhum valor entra no evento de auditoria.
alter table public.followup_enrollments add column if not exists variables jsonb not null default '{}'::jsonb;

create or replace function public.fn_guard_followup_variables()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if current_setting('role',true) in ('anon','authenticated') and
   ((tg_op='INSERT' and new.variables <> '{}'::jsonb) or (tg_op='UPDATE' and new.variables is distinct from old.variables)) then
   raise exception 'session_variables_server_only' using errcode='42501';
 end if;
 if jsonb_typeof(new.variables) is distinct from 'object' or octet_length(new.variables::text)>32768 then
   raise exception 'invalid_session_variables' using errcode='22023';
 end if;
 return new;
end; $$;
revoke all on function public.fn_guard_followup_variables() from public,anon,authenticated;
drop trigger if exists trg_guard_followup_variables on public.followup_enrollments;
create trigger trg_guard_followup_variables before insert or update on public.followup_enrollments
 for each row execute function public.fn_guard_followup_variables();

create or replace function public.fn_followup_set_variable(
 p_org uuid,p_id uuid,p_revision bigint,p_node text,p_next text,p_key text,p_type text,p_value jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare current public.followup_enrollments; contact uuid; next_variables jsonb; changed bigint; boundary jsonb;
begin
 select contact_id into contact from public.followup_enrollments where organization_id=p_org and id=p_id;
 if not found then raise exception 'followup_stale' using errcode='40001'; end if;
 perform public.fn_service_lock(p_org,contact);
 select * into current from public.followup_enrollments where organization_id=p_org and id=p_id for update;
 boundary:=public.fn_service_boundary(p_org,current.conversation_id);
 if current.service_boundary is null or boundary is null or not (boundary @> current.service_boundary)
   or boundary->>'status' in ('closed','resolved','archived') or boundary->>'demanda_fechada_em' is not null then
   raise exception 'followup_stale' using errcode='40001'; end if;
 if current.revision is distinct from p_revision or current.current_node_id is distinct from p_node
   or current.status not in ('active','waiting_reply') then raise exception 'followup_stale' using errcode='40001'; end if;
 if p_key is null or p_key !~ '^[a-zA-Z][a-zA-Z0-9_]{0,59}$'
   or lower(p_key) in ('constructor','prototype','password','secret','token','api_key')
   or p_type is null or p_type not in ('string','number','boolean')
   or p_value is null or jsonb_typeof(p_value) is distinct from p_type or octet_length(p_value::text)>8000
   or (p_type='string' and char_length(p_value #>> '{}')>2000) then
   raise exception 'invalid_variable' using errcode='22023'; end if;
 if current.variables ? p_key and current.variables->p_key->>'type' is distinct from p_type then
   raise exception 'variable_type_mismatch' using errcode='22023'; end if;
 if p_next is null or not exists (
   select 1 from public.followup_flow_versions v, jsonb_array_elements(v.graph->'nodes') n
   where v.organization_id=p_org and v.id=current.version_id and n->>'id'=p_next
 ) then raise exception 'invalid_next_node' using errcode='22023'; end if;
 if not exists (
   select 1 from public.followup_flow_versions v, jsonb_array_elements(v.graph->'edges') e
   where v.organization_id=p_org and v.id=current.version_id and e->>'source'=p_node and e->>'target'=p_next
 ) then raise exception 'invalid_next_edge' using errcode='22023'; end if;
 next_variables:=current.variables||jsonb_build_object(p_key,jsonb_build_object('type',p_type,'value',p_value));
 if (select count(*) from jsonb_object_keys(next_variables))>50 or octet_length(next_variables::text)>32768 then
   raise exception 'variable_limit_exceeded' using errcode='22023'; end if;
 update public.followup_enrollments set variables=next_variables where organization_id=p_org and id=p_id returning revision into changed;
 return public.fn_followup_apply_step(p_org,p_id,changed,
   jsonb_build_object('current_node_id',p_next,'status','active','next_eval_at',now(),'claimed_until',null,'steps_taken',current.steps_taken+1),
   jsonb_build_object('node_id',p_node,'event_type','variable_set','idempotency_key',p_node||':'||current.steps_taken,
     'payload',jsonb_build_object('key',p_key,'value_type',p_type)));
end; $$;
revoke all on function public.fn_followup_set_variable(uuid,uuid,bigint,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fn_followup_set_variable(uuid,uuid,bigint,text,text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
