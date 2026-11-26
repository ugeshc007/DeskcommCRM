-- Field officers work only through the server-scoped Field Sales API. They do
-- not inherit viewer/agent RLS permissions elsewhere in the CRM.
alter table public.user_organizations drop constraint if exists user_organizations_role_check;
alter table public.user_organizations add constraint user_organizations_role_check
  check (role in ('field_officer','viewer','agent','manager','admin'));
alter table public.team_invites drop constraint if exists team_invites_role_check;
alter table public.team_invites add constraint team_invites_role_check
  check (role in ('field_officer','viewer','agent','manager','admin'));

-- Archived invitations remain in the database so signed, revoked URLs cannot
-- become valid again through the legacy stateless invite fallback.
alter table public.team_invites add column if not exists archived_at timestamptz;

-- Many legacy tenant policies grant all active members org-wide read via this
-- helper. A mobile-only officer must not enter that broad membership set.
create or replace function public.fn_user_org_ids()
returns setof uuid language sql stable security definer set search_path = public as $f$
 select organization_id from public.user_organizations
 where user_id=auth.uid() and revoked_at is null and role <> 'field_officer'
 union select (s->>'organization_id')::uuid from (select public.fn_support_context() s) c where s->>'status'='active';
$f$;
revoke execute on function public.fn_user_org_ids() from public,anon;
grant execute on function public.fn_user_org_ids() to authenticated,service_role;

create or replace function public.fn_accept_team_invite(
  p_user uuid, p_org uuid, p_role text, p_invited_by uuid,
  p_issued_at timestamptz, p_invited_at timestamptz,
  p_interface_settings jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.user_organizations%rowtype;
begin
  if p_role not in ('field_officer','viewer','agent','manager','admin') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_org::text, 0));
  if not exists(select 1 from public.organizations where id = p_org and status = 'active') then
    raise exception 'organization_unavailable' using errcode = '42501';
  end if;
  select * into m from public.user_organizations
    where organization_id = p_org and user_id = p_user for update;
  if found and m.revoked_at is null and m.accepted_at is not null then
    return jsonb_build_object('id', m.id, 'changed', false);
  end if;
  if found and m.revoked_at is not null and (p_issued_at is null or p_issued_at <= m.revoked_at) then
    raise exception 'invite_revoked' using errcode = '42501';
  end if;
  if m.id is not null then
    update public.user_organizations set role = p_role, revoked_at = null, interface_settings = p_interface_settings,
      invited_by = coalesce(p_invited_by, invited_by), invited_at = p_invited_at,
      accepted_at = now(), updated_at = now()
      where organization_id = p_org and id = m.id returning * into m;
  else
    insert into public.user_organizations(organization_id, user_id, role, invited_by, invited_at, accepted_at, interface_settings)
      values (p_org, p_user, p_role, p_invited_by, p_invited_at, now(), p_interface_settings) returning * into m;
  end if;
  return jsonb_build_object('id', m.id, 'changed', true);
end $$;
revoke execute on function public.fn_accept_team_invite(uuid,uuid,text,uuid,timestamptz,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.fn_accept_team_invite(uuid,uuid,text,uuid,timestamptz,timestamptz,jsonb) to service_role;
