-- Optional retail lead profile. Existing CRM leads and tenants are unaffected.
-- The lead UUID is the immutable Event ID; the phone uniqueness rule applies
-- only while an event is open, preserving all closed historical events.
create table if not exists public.crm_retail_store_assignments (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_name text not null check (length(trim(store_name)) between 1 and 120),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create unique index if not exists crm_leads_id_org_for_retail_fk
  on public.crm_leads (id, organization_id);

create table if not exists public.crm_retail_leads (
  lead_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  primary_phone text not null check (primary_phone ~ '^\+[0-9]{8,15}$'),
  secondary_phone text check (secondary_phone is null or secondary_phone ~ '^\+[0-9]{8,15}$'),
  how_known text,
  products text[] not null check (array_length(products, 1) is not null),
  store_name text not null check (length(trim(store_name)) between 1 and 120),
  address text,
  next_followup_at timestamptz,
  active boolean not null default true,
  retention_parent_lead_id uuid references public.crm_leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_retail_leads_open_has_followup check (not active or next_followup_at is not null),
  constraint crm_retail_leads_lead_org_fkey foreign key (lead_id, organization_id)
    references public.crm_leads(id, organization_id) on delete cascade deferrable initially immediate
);

create unique index if not exists crm_retail_one_open_event_per_phone
  on public.crm_retail_leads (organization_id, primary_phone) where active;
create index if not exists crm_retail_followups_due
  on public.crm_retail_leads (organization_id, next_followup_at) where active;

create table if not exists public.crm_retail_followup_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null,
  due_at timestamptz not null,
  completed_at timestamptz not null default now(),
  next_due_at timestamptz,
  stage_from uuid not null references public.crm_stages(id),
  stage_to uuid not null references public.crm_stages(id),
  performed_by_user_id uuid not null references auth.users(id),
  note text,
  constraint crm_retail_followup_lead_org_fkey foreign key (lead_id, organization_id)
    references public.crm_leads(id, organization_id) on delete cascade deferrable initially immediate
);
create index if not exists crm_retail_followup_history
  on public.crm_retail_followup_actions(organization_id,lead_id,completed_at desc);

alter table public.crm_retail_store_assignments enable row level security;
alter table public.crm_retail_leads enable row level security;
alter table public.crm_retail_followup_actions enable row level security;
drop policy if exists tenant_isolation_crm_retail_store_assignments_all on public.crm_retail_store_assignments;
create policy tenant_isolation_crm_retail_store_assignments_all on public.crm_retail_store_assignments
  for all using (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'))
  with check (organization_id in (select public.fn_user_org_ids()) and public.fn_role_at_least(organization_id, 'manager'));
drop policy if exists tenant_isolation_crm_retail_leads_all on public.crm_retail_leads;
drop policy if exists tenant_isolation_crm_retail_leads_select on public.crm_retail_leads;
create policy tenant_isolation_crm_retail_leads_select on public.crm_retail_leads
  for select using (organization_id in (select public.fn_user_org_ids())
    and exists (select 1 from public.crm_leads l where l.id=lead_id
      and l.organization_id=crm_retail_leads.organization_id
      and public.fn_can_view_lead(l.organization_id,l.owner_user_id)));
drop policy if exists tenant_isolation_crm_retail_followup_actions_all on public.crm_retail_followup_actions;
drop policy if exists tenant_isolation_crm_retail_followup_actions_select on public.crm_retail_followup_actions;
create policy tenant_isolation_crm_retail_followup_actions_select on public.crm_retail_followup_actions
  for select using (organization_id in (select public.fn_user_org_ids())
    and exists (select 1 from public.crm_leads l where l.id=lead_id
      and l.organization_id=crm_retail_followup_actions.organization_id
      and public.fn_can_view_lead(l.organization_id,l.owner_user_id)));

create or replace function public.fn_sync_retail_lead_active() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update public.crm_retail_leads
       set active = (new.status = 'open'),
           next_followup_at = case when new.status = 'open' then next_followup_at else null end,
           updated_at = now()
     where lead_id = new.id and organization_id = new.organization_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.fn_sync_retail_lead_active() from public, anon, authenticated;
drop trigger if exists trg_sync_retail_lead_active on public.crm_leads;
create trigger trg_sync_retail_lead_active after update of status on public.crm_leads
  for each row execute function public.fn_sync_retail_lead_active();

-- The manager configures a salesperson's store once; lead entry then derives
-- the store from the authenticated person instead of trusting a form field.
create or replace function public.fn_assign_retail_store(p_org uuid, p_user uuid, p_store text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.fn_role_at_least(p_org, 'manager')
     or not public.fn_support_write_allowed(p_org) then
    raise exception 'retail_store_forbidden' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_store, ''))) not between 1 and 120 then
    raise exception 'retail_store_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.user_organizations u
                 where u.organization_id = p_org and u.user_id = p_user
                   and u.accepted_at is not null and u.revoked_at is null) then
    raise exception 'retail_user_unavailable' using errcode = '22023';
  end if;
  insert into public.crm_retail_store_assignments(organization_id,user_id,store_name)
  values(p_org,p_user,trim(p_store))
  on conflict(organization_id,user_id) do update
    set store_name=excluded.store_name,updated_at=now();
  insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id)
  values(p_org,auth.uid(),'retail_store.assigned','user',p_user);
end;
$$;
revoke execute on function public.fn_assign_retail_store(uuid,uuid,text) from public, anon;
grant execute on function public.fn_assign_retail_store(uuid,uuid,text) to authenticated;

create or replace function public.fn_my_retail_store(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select a.store_name from public.crm_retail_store_assignments a
  join public.user_organizations u on u.organization_id=a.organization_id
    and u.user_id=a.user_id and u.accepted_at is not null and u.revoked_at is null
  where a.organization_id=p_org and a.user_id=auth.uid()
    and public.fn_role_at_least(p_org,'agent');
$$;
revoke execute on function public.fn_my_retail_store(uuid) from public, anon;
grant execute on function public.fn_my_retail_store(uuid) to authenticated;

create or replace function public.fn_create_retail_lead(
  p_org uuid, p_pipeline uuid, p_stage uuid, p_name text, p_phone text,
  p_secondary_phone text, p_email text, p_source text, p_how_known text,
  p_products text[], p_budget_cents bigint, p_purchase_date date,
  p_address text, p_next_followup_at timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_store text;
  v_contact uuid;
  v_contact_ids uuid[];
  v_existing_email text;
  v_lead uuid;
  v_position numeric;
  v_currency text;
begin
  if v_actor is null or not public.fn_role_at_least(p_org, 'agent')
     or not public.fn_support_write_allowed(p_org) then
    raise exception 'retail_lead_forbidden' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name,''))) < 2
     or coalesce(p_phone,'') !~ '^\+[0-9]{8,15}$'
     or length(trim(coalesce(p_source,''))) = 0
     or p_budget_cents is null or p_budget_cents < 0
     or p_purchase_date is null
     or p_next_followup_at is null or p_next_followup_at <= now()
     or coalesce(array_length(p_products,1),0) = 0 then
    raise exception 'retail_lead_invalid' using errcode = '22023';
  end if;
  if p_secondary_phone is not null and p_secondary_phone !~ '^\+[0-9]{8,15}$' then
    raise exception 'retail_lead_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.crm_stages s
                 where s.id=p_stage and s.pipeline_id=p_pipeline
                   and s.organization_id=p_org and not s.is_won
                   and not s.is_lost and not s.is_archived) then
    raise exception 'retail_stage_unavailable' using errcode = '22023';
  end if;
  select a.store_name into v_store from public.crm_retail_store_assignments a
    join public.user_organizations u on u.organization_id=a.organization_id
      and u.user_id=a.user_id and u.accepted_at is not null and u.revoked_at is null
   where a.organization_id=p_org and a.user_id=v_actor;
  if v_store is null then
    raise exception 'retail_store_unassigned' using errcode = '22023';
  end if;
  select o.currency into v_currency from public.organizations o where o.id=p_org;
  if exists(select 1 from public.crm_retail_leads r
            where r.organization_id=p_org and r.primary_phone=p_phone and r.active) then
    raise exception 'retail_event_open' using errcode = '23505';
  end if;
  -- The partial unique index on open profiles is the concurrency-safe guard.
  -- A conflict rolls back both inserts in this function's transaction.
  select array_agg(c.id order by c.created_at,c.id) into v_contact_ids
    from public.contacts c where c.organization_id=p_org and c.phone_number=p_phone
      and not c.is_anonymized and c.is_merged_into is null;
  if coalesce(array_length(v_contact_ids,1),0) > 1 then
    raise exception 'retail_phone_ambiguous' using errcode = '22023';
  end if;
  if coalesce(array_length(v_contact_ids,1),0) = 1 then
    v_contact := v_contact_ids[1];
    select c.email into v_existing_email from public.contacts c
      where c.id=v_contact and c.organization_id=p_org for update;
    if v_existing_email is not null and p_email is not null
       and lower(trim(v_existing_email)) <> lower(trim(p_email)) then
      raise exception 'retail_phone_identity_conflict' using errcode = '22023';
    end if;
    if v_existing_email is null and nullif(trim(p_email),'') is not null then
      update public.contacts set email=trim(p_email),updated_at=now()
        where id=v_contact and organization_id=p_org;
    end if;
  else
    insert into public.contacts(organization_id,name,display_name,phone_number,email,source,created_by_user_id)
    values(p_org,trim(p_name),trim(p_name),p_phone,nullif(trim(p_email),''),p_source,v_actor)
    returning id into v_contact;
  end if;
  select coalesce(max(position_in_stage),0)+1000 into v_position
    from public.crm_leads where organization_id=p_org and stage_id=p_stage;
  insert into public.crm_leads(organization_id,pipeline_id,stage_id,contact_id,title,status,
    position_in_stage,value_cents,currency,owner_user_id,owner_kind,assigned_at,expected_close_date,
    source,created_by_user_id,custom_fields)
  values(p_org,p_pipeline,p_stage,v_contact,trim(p_name),'open',v_position,p_budget_cents,coalesce(v_currency,'USD'),
    v_actor,'user',now(),p_purchase_date,p_source,v_actor,'{"retail_status":"Created"}'::jsonb)
  returning id into v_lead;
  insert into public.crm_retail_leads(lead_id,organization_id,primary_phone,secondary_phone,
    how_known,products,store_name,address,next_followup_at)
  values(v_lead,p_org,p_phone,p_secondary_phone,nullif(trim(p_how_known),''),p_products,
    v_store,nullif(trim(p_address),''),p_next_followup_at);
  insert into public.crm_lead_activities(organization_id,lead_id,contact_id,source_module,
    source_id,type,payload,performed_by_user_id)
  values(p_org,v_lead,v_contact,'crm',v_lead,'lead_created',
    jsonb_build_object('next_followup_at',p_next_followup_at),v_actor);
  insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id)
  values(p_org,v_actor,'retail_lead.created','crm_lead',v_lead);
  return v_lead;
end;
$$;
revoke execute on function public.fn_create_retail_lead(uuid,uuid,uuid,text,text,text,text,text,text,text[],bigint,date,text,timestamptz) from public, anon;
grant execute on function public.fn_create_retail_lead(uuid,uuid,uuid,text,text,text,text,text,text,text[],bigint,date,text,timestamptz) to authenticated;

create or replace function public.fn_complete_retail_followup(
  p_org uuid, p_lead uuid, p_expected_due_at timestamptz, p_next_stage uuid,
  p_next_due_at timestamptz, p_note text, p_lost_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_lead public.crm_leads%rowtype;
  v_profile public.crm_retail_leads%rowtype;
  v_stage public.crm_stages%rowtype;
begin
  if v_actor is null or not public.fn_role_at_least(p_org,'agent')
     or not public.fn_support_write_allowed(p_org) then
    raise exception 'retail_followup_forbidden' using errcode='42501';
  end if;
  select * into v_lead from public.crm_leads
    where id=p_lead and organization_id=p_org for update;
  if not found or not public.fn_can_view_lead(v_lead.organization_id,v_lead.owner_user_id)
     or v_lead.status <> 'open' then
    raise exception 'retail_lead_unavailable' using errcode='22023';
  end if;
  select * into v_profile from public.crm_retail_leads
    where lead_id=p_lead and organization_id=p_org and active for update;
  if not found or v_profile.next_followup_at is distinct from p_expected_due_at then
    raise exception 'retail_followup_changed' using errcode='22023';
  end if;
  select * into v_stage from public.crm_stages
    where id=p_next_stage and organization_id=p_org and pipeline_id=v_lead.pipeline_id
      and not is_archived;
  if not found then raise exception 'retail_stage_unavailable' using errcode='22023'; end if;
  if not v_stage.is_won and not v_stage.is_lost and
     (p_next_due_at is null or p_next_due_at <= now()) then
    raise exception 'retail_next_followup_required' using errcode='22023';
  end if;
  if v_stage.is_lost and length(trim(coalesce(p_lost_reason,''))) = 0 then
    raise exception 'retail_lost_reason_required' using errcode='22023';
  end if;
  update public.crm_leads set stage_id=p_next_stage,
    lost_reason=case when v_stage.is_lost then trim(p_lost_reason) else null end,
    custom_fields=coalesce(custom_fields,'{}'::jsonb) || jsonb_build_object(
      'retail_status',case when v_stage.is_won then 'Converted'
        when v_stage.is_lost then 'Lost' else v_stage.name end),
    updated_at=now()
    where id=p_lead and organization_id=p_org;
  update public.crm_retail_leads
    set next_followup_at=case when v_stage.is_won or v_stage.is_lost then null else p_next_due_at end,
        updated_at=now()
    where lead_id=p_lead and organization_id=p_org;
  insert into public.crm_retail_followup_actions(organization_id,lead_id,due_at,next_due_at,
    stage_from,stage_to,performed_by_user_id,note)
  values(p_org,p_lead,v_profile.next_followup_at,
    case when v_stage.is_won or v_stage.is_lost then null else p_next_due_at end,
    v_lead.stage_id,p_next_stage,v_actor,nullif(trim(p_note),''));
  insert into public.crm_lead_activities(organization_id,lead_id,contact_id,source_module,
    source_id,type,payload,performed_by_user_id)
  values(p_org,p_lead,v_lead.contact_id,'crm',p_lead,'retail_followup_done',
    jsonb_build_object('previous_due_at',v_profile.next_followup_at,
      'next_due_at',case when v_stage.is_won or v_stage.is_lost then null else p_next_due_at end,
      'note',nullif(trim(p_note),'')),v_actor);
  insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id)
  values(p_org,v_actor,'retail_followup.completed','crm_lead',p_lead);
  return jsonb_build_object('lead_id',p_lead,'status',case when v_stage.is_won then 'Converted'
    when v_stage.is_lost then 'Lost' else v_stage.name end,
    'next_followup_at',case when v_stage.is_won or v_stage.is_lost then null else p_next_due_at end);
end;
$$;
revoke execute on function public.fn_complete_retail_followup(uuid,uuid,timestamptz,uuid,timestamptz,text,text) from public, anon;
grant execute on function public.fn_complete_retail_followup(uuid,uuid,timestamptz,uuid,timestamptz,text,text) to authenticated;

create or replace function public.fn_next_retail_workday_at(p_due timestamptz,p_timezone text)
returns timestamptz language plpgsql stable security invoker set search_path = public as $$
declare v_local timestamp; begin
  v_local := (p_due at time zone p_timezone) + interval '1 day';
  while extract(isodow from v_local) > 5 loop
    v_local := v_local + interval '1 day';
  end loop;
  return v_local at time zone p_timezone;
end;
$$;
revoke execute on function public.fn_next_retail_workday_at(timestamptz,text) from public, anon;
grant execute on function public.fn_next_retail_workday_at(timestamptz,text) to authenticated;

create or replace function public.fn_retail_overdue_followups(p_org uuid,p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'lead_id',q.lead_id,'title',q.title,'pipeline_id',q.pipeline_id,
    'owner_user_id',q.owner_user_id,'store_name',q.store_name,
    'due_at',q.next_followup_at,'escalation_at',q.escalation_at,
    'escalated',q.escalation_at <= now()
  ) order by q.next_followup_at,q.lead_id),'[]'::jsonb)
  from (select r.lead_id,l.title,l.pipeline_id,l.owner_user_id,r.store_name,r.next_followup_at,
      public.fn_next_retail_workday_at(r.next_followup_at,o.timezone) escalation_at
    from public.crm_retail_leads r
    join public.crm_leads l on l.id=r.lead_id and l.organization_id=r.organization_id
    join public.organizations o on o.id=r.organization_id
    where r.organization_id=p_org and public.fn_role_at_least(p_org,'manager')
      and r.active and r.next_followup_at < now()
    order by r.next_followup_at,r.lead_id
    limit greatest(1,least(coalesce(p_limit,100),200))) q;
$$;
revoke execute on function public.fn_retail_overdue_followups(uuid,integer) from public, anon;
grant execute on function public.fn_retail_overdue_followups(uuid,integer) to authenticated;

-- Move the existing Event ID and its activity history in one transaction. A
-- lead/contact with other linked records is rejected rather than leaving a
-- readable source-tenant fragment or changing an unrelated record's tenant.
create or replace function public.fn_transfer_retail_lead(
  p_source_org uuid, p_destination_org uuid, p_lead uuid,
  p_destination_pipeline uuid, p_destination_stage uuid, p_destination_owner uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_lead public.crm_leads%rowtype;
  v_profile public.crm_retail_leads%rowtype;
  v_contact uuid;
  v_store text;
  v_dependency record;
  v_count bigint;
begin
  if p_source_org is null or p_destination_org is null or p_source_org=p_destination_org
     or auth.uid() is null
     or not public.fn_role_at_least(p_source_org,'manager')
     or not public.fn_role_at_least(p_destination_org,'manager')
     or not public.fn_support_write_allowed(p_source_org)
     or not public.fn_support_write_allowed(p_destination_org) then
    raise exception 'retail_transfer_forbidden' using errcode='42501';
  end if;
  select * into v_lead from public.crm_leads
    where id=p_lead and organization_id=p_source_org and status='open' for update;
  if not found or v_lead.contact_id is null then
    raise exception 'retail_transfer_unavailable' using errcode='22023';
  end if;
  select * into v_profile from public.crm_retail_leads
    where lead_id=p_lead and organization_id=p_source_org and active for update;
  if not found then raise exception 'retail_transfer_unavailable' using errcode='22023'; end if;
  if not exists (select 1 from public.crm_stages s
    where s.id=p_destination_stage and s.pipeline_id=p_destination_pipeline
      and s.organization_id=p_destination_org and not s.is_won
      and not s.is_lost and not s.is_archived) then
    raise exception 'retail_destination_stage_unavailable' using errcode='22023';
  end if;
  select a.store_name into v_store from public.crm_retail_store_assignments a
    join public.user_organizations u on u.organization_id=a.organization_id
      and u.user_id=a.user_id and u.accepted_at is not null and u.revoked_at is null
    where a.organization_id=p_destination_org and a.user_id=p_destination_owner;
  if v_store is null then
    raise exception 'retail_destination_owner_store_unavailable' using errcode='22023';
  end if;
  if exists (select 1 from public.crm_retail_leads r where
    r.organization_id=p_destination_org and r.primary_phone=v_profile.primary_phone and r.active) then
    raise exception 'retail_event_open' using errcode='23505';
  end if;
  if exists (select 1 from public.crm_lead_activities a
    where a.organization_id=p_source_org and a.lead_id=p_lead
      and (a.source_module <> 'crm' or (a.source_id is not null and a.source_id <> p_lead))) then
    raise exception 'retail_transfer_linked_records' using errcode='22023';
  end if;

  -- Every other lead FK is checked from the live catalogue. New modules that
  -- add linked records fail closed until their transfer semantics are defined.
  for v_dependency in
    select c.conrelid::regclass as table_name, a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='public.crm_leads'::regclass
      and array_length(c.conkey,1)=1
      and c.conrelid not in ('public.crm_lead_activities'::regclass,
        'public.crm_retail_leads'::regclass,'public.crm_retail_followup_actions'::regclass)
  loop
    execute format('select count(*) from %s where %I=$1',v_dependency.table_name,v_dependency.column_name)
      into v_count using p_lead;
    if v_count > 0 then
      raise exception 'retail_transfer_linked_records' using errcode='22023';
    end if;
  end loop;

  v_contact := v_lead.contact_id;
  perform 1 from public.contacts where id=v_contact and organization_id=p_source_org for update;
  if not found then
    raise exception 'retail_transfer_linked_contact' using errcode='22023';
  end if;
  select count(*) into v_count from public.crm_leads where contact_id=v_contact;
  if v_count <> 1 then
    raise exception 'retail_transfer_shared_contact' using errcode='22023';
  end if;
  -- The source contact travels with the Event ID. Other references to that
  -- contact (including conversations) must not remain in the source tenant.
  for v_dependency in
    select c.conrelid::regclass as table_name, a.attname as column_name
    from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='public.contacts'::regclass
      and array_length(c.conkey,1)=1
      and c.conrelid not in ('public.crm_leads'::regclass,
        'public.crm_lead_activities'::regclass)
  loop
    execute format('select count(*) from %s where %I=$1',v_dependency.table_name,v_dependency.column_name)
      into v_count using v_contact;
    if v_count > 0 then
      raise exception 'retail_transfer_linked_contact' using errcode='22023';
    end if;
  end loop;
  if exists (select 1 from public.contacts c where c.organization_id=p_destination_org
    and (c.phone_number=v_profile.primary_phone or
      (c.email is not null and c.email=(select email from public.contacts where id=v_contact)))) then
    raise exception 'retail_destination_contact_exists' using errcode='22023';
  end if;

  set constraints crm_retail_leads_lead_org_fkey, crm_retail_followup_lead_org_fkey deferred;
  update public.contacts set organization_id=p_destination_org,updated_at=now()
    where id=v_contact and organization_id=p_source_org;
  update public.crm_leads set organization_id=p_destination_org,
    pipeline_id=p_destination_pipeline,stage_id=p_destination_stage,
    owner_user_id=p_destination_owner,owner_kind='user',owner_agent_id=null,
    assigned_at=now(),position_in_stage=1000,
    custom_fields=coalesce(custom_fields,'{}'::jsonb) ||
      jsonb_build_object('retail_transferred_from_org_id',p_source_org),updated_at=now()
    where id=p_lead and organization_id=p_source_org;
  update public.crm_lead_activities set organization_id=p_destination_org
    where lead_id=p_lead and organization_id=p_source_org;
  update public.crm_retail_leads set organization_id=p_destination_org,
    store_name=v_store,updated_at=now()
    where lead_id=p_lead and organization_id=p_source_org;
  update public.crm_retail_followup_actions set organization_id=p_destination_org
    where lead_id=p_lead and organization_id=p_source_org;
  insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id)
  values(p_source_org,auth.uid(),'retail_lead.transferred_out','crm_lead',p_lead),
        (p_destination_org,auth.uid(),'retail_lead.transferred_in','crm_lead',p_lead);
  return p_lead;
end;
$$;
revoke execute on function public.fn_transfer_retail_lead(uuid,uuid,uuid,uuid,uuid,uuid) from public, anon;
grant execute on function public.fn_transfer_retail_lead(uuid,uuid,uuid,uuid,uuid,uuid) to authenticated;

-- Keep profiles readable through tenant RLS but mutation only through guarded
-- functions; an agent must not flip active=false to bypass the open-event rule.
revoke insert, update, delete on public.crm_retail_leads from authenticated;
revoke insert, update, delete on public.crm_retail_store_assignments from authenticated;
revoke insert, update, delete on public.crm_retail_followup_actions from authenticated;
grant select on public.crm_retail_leads, public.crm_retail_store_assignments,
  public.crm_retail_followup_actions to authenticated;

notify pgrst, 'reload schema';
