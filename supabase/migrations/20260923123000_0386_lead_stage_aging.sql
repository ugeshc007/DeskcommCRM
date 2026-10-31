-- Lead stage aging, scoped to the active organization and caller RLS.
-- stage_changed_at is maintained by the existing CRM lead trigger.
create or replace function public.fn_lead_stage_aging(
  p_org uuid, p_min_days integer, p_limit integer default 100
)
returns jsonb
language sql stable security invoker
set search_path = public
as $$
  with aged as (
    select l.id, l.title, l.pipeline_id, l.stage_id, s.name as stage_name,
      l.owner_user_id, l.stage_changed_at as stage_since
    from public.crm_leads l
    join public.crm_stages s
      on s.id = l.stage_id and s.organization_id = l.organization_id
    where l.organization_id = p_org and l.status = 'open'
      and l.stage_changed_at <= now() - make_interval(days => greatest(1, least(p_min_days, 365)))
  ),
  selected as (
    select * from aged
    order by stage_since asc, id asc
    limit greatest(1, least(p_limit, 200))
  )
  select jsonb_build_object(
    'total', (select count(*) from aged),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id, 'title', title, 'pipeline_id', pipeline_id,
          'stage_id', stage_id, 'stage_name', stage_name,
          'owner_user_id', owner_user_id, 'stage_since', stage_since
        ) order by stage_since asc, id asc
      ) from selected
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.fn_lead_stage_aging(uuid, integer, integer) from public, anon;
grant execute on function public.fn_lead_stage_aging(uuid, integer, integer) to authenticated;
