-- Child-facing missions have a small, parent-configurable cooldown.
-- The client defaults to 120 seconds until mission management exposes this field.
begin;

alter table public.missions
  add column repeat_cooldown_seconds integer not null default 120
  check (repeat_cooldown_seconds >= 0);

comment on column public.missions.repeat_cooldown_seconds is
  'Seconds between child-facing mission awards for the same child; 0 disables the cooldown.';

-- The prior once-daily unique index is replaced by the configurable cooldown.
-- Historical completion snapshots remain unchanged.
drop index public.once_daily_award;

-- The child-row lock in award_mission serializes awards for a child, so a
-- second device evaluates this history only after the first request commits.
create index mission_completions_cooldown_lookup
  on public.mission_completions (child_id, mission_id, completed_at desc)
  where undone_at is null;

create or replace function public.award_mission(p_child_id uuid, p_mission_id uuid, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_child public.children%rowtype;
  v_mission public.missions%rowtype;
  v_old public.mission_completions%rowtype;
  v_zone text;
  v_at timestamptz;
  v_day date;
  v_last_completed_at timestamptz;
  v_id uuid;
begin
  select * into v_child from public.children where id = p_child_id;
  perform app_private.require_member(v_child.family_id);

  -- This is the shared serialization point for awards, undo, and redemption.
  select * into strict v_child from public.children where id = p_child_id for update;

  -- A transport retry returns its original ledger row, even during cooldown.
  select * into v_old from public.mission_completions
    where child_id = p_child_id and request_id = p_request_id;
  if found then
    if v_old.mission_id is distinct from p_mission_id
       or v_old.recorded_by is distinct from auth.uid() then
      raise exception 'Request ID reused';
    end if;
    return v_old.id;
  end if;

  if v_child.archived_at is not null then raise exception 'Child is archived'; end if;
  select * into v_mission from public.missions
    where id = p_mission_id and family_id = v_child.family_id for share;
  if not found or v_mission.archived_at is not null then raise exception 'Mission unavailable'; end if;

  select time_zone into v_zone from public.families where id = v_child.family_id;
  v_at := clock_timestamp();
  v_day := (v_at at time zone v_zone)::date;

  if v_mission.repeat_cooldown_seconds > 0 then
    select max(completed_at) into v_last_completed_at
      from public.mission_completions
      where child_id = p_child_id and mission_id = p_mission_id
        and undone_at is null;

    if v_last_completed_at is not null
       and v_last_completed_at + make_interval(secs => v_mission.repeat_cooldown_seconds) > v_at then
      raise exception 'Mission will be ready again shortly';
    end if;
  end if;

  insert into public.mission_completions(
    family_id, child_id, mission_id, recorded_by, request_id, completed_at,
    completed_on, time_zone_snapshot, mission_name_snapshot, emoji_snapshot,
    stars_earned, frequency_snapshot
  ) values (
    v_child.family_id, p_child_id, p_mission_id, auth.uid(), p_request_id, v_at,
    v_day, v_zone, v_mission.name, v_mission.emoji, v_mission.stars, v_mission.frequency
  ) returning id into v_id;
  return v_id;
end;
$$;

grant insert (family_id, category_id, name, emoji, stars, frequency, repeat_cooldown_seconds)
  on public.missions to authenticated;
grant update (category_id, name, emoji, stars, frequency, repeat_cooldown_seconds, archived_at)
  on public.missions to authenticated;
grant execute on function public.award_mission(uuid, uuid, uuid) to authenticated;

commit;
