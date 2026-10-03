-- Household mission display order. Apply after the existing 20260927 migrations.
-- Requires active memberships (20260921000200_email_household_invites.sql).
begin;

alter table public.missions add column sort_order integer;
with ranked as (
  select id, (row_number() over (partition by family_id order by created_at, id) * 10)::integer as position
  from public.missions where archived_at is null
)
update public.missions m set sort_order = r.position from ranked r where r.id = m.id;
update public.missions set sort_order = 0 where sort_order is null;
alter table public.missions alter column sort_order set not null;
alter table public.missions add constraint missions_sort_order_nonnegative check (sort_order >= 0);
create index missions_active_order on public.missions(family_id, sort_order, created_at, id)
  where archived_at is null;

-- Inserts and reorders share one household lock. No creation-form changes needed.
create function app_private.assign_mission_sort_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mission-order:' || new.family_id::text, 0));
  select coalesce(max(m.sort_order), 0) + 10 into new.sort_order
    from public.missions m where m.family_id = new.family_id and m.archived_at is null;
  return new;
end;
$$;
revoke all on function app_private.assign_mission_sort_order() from public, anon, authenticated;
create trigger missions_assign_sort_order before insert on public.missions
  for each row execute function app_private.assign_mission_sort_order();

-- INVOKER deliberately keeps existing mission RLS in force.
create function public.reorder_missions(p_family_id uuid, p_mission_ids uuid[])
returns table(id uuid, sort_order integer)
language plpgsql security invoker set search_path = '' as $$
declare v_current uuid[];
begin
  if auth.uid() is null or not exists (
    select 1 from public.family_memberships fm
    where fm.family_id = p_family_id and fm.parent_id = auth.uid()
      and fm.left_at is null and fm.role in ('owner', 'parent')
  ) then
    raise exception 'Family access denied' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Mission ordering requires READ COMMITTED isolation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mission-order:' || p_family_id::text, 0));
  -- Serialize against soft deletion too, without changing any mission identity.
  perform m.id from public.missions m where m.family_id = p_family_id order by m.id for update;
  select coalesce(array_agg(m.id order by m.sort_order, m.created_at, m.id), '{}'::uuid[])
    into v_current from public.missions m where m.family_id = p_family_id and m.archived_at is null;
  if p_mission_ids is null
     or cardinality(p_mission_ids) <> cardinality(v_current)
     or (select count(distinct item) from unnest(p_mission_ids) item) <> cardinality(v_current)
     or not (p_mission_ids @> v_current and p_mission_ids <@ v_current) then
    raise exception 'Mission list changed. Refresh and try again.';
  end if;
  if p_mission_ids is distinct from v_current then
    update public.missions m set sort_order = (requested.position * 10)::integer
    from unnest(p_mission_ids) with ordinality as requested(mission_id, position)
    where m.id = requested.mission_id and m.family_id = p_family_id
      and m.archived_at is null and m.sort_order is distinct from (requested.position * 10)::integer;
  end if;
  return query select m.id, m.sort_order from public.missions m
    where m.family_id = p_family_id and m.archived_at is null order by m.sort_order, m.created_at, m.id;
end;
$$;
grant update (sort_order) on public.missions to authenticated;
revoke all on function public.reorder_missions(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_missions(uuid, uuid[]) to authenticated;
comment on column public.missions.sort_order is
  'Household-wide display position. New missions append automatically. Future child-specific order can override this household default without changing ledger references.';
commit;
