-- Parent-created repeatable missions with validated icon keys and per-mission cooldowns.
-- Requires 20260921000100_repeatable_mission_cooldowns.sql.
begin;

alter table public.missions add column if not exists icon_key text not null default 'star';

-- Existing rows keep their IDs, family ownership, completion history, and emoji snapshots.
update public.missions set icon_key = case emoji
  when '💩' then 'potty'
  when '🚽' then 'potty'
  when '👕' then 'clothes'
  when '🪥' then 'toothbrush'
  when '🥣' then 'food'
  when '🐱' then 'cat'
  when '🐶' then 'pet'
  when '🧸' then 'toys'
  when '🧺' then 'laundry'
  when '🍽️' then 'dishes'
  else 'star'
end
where icon_key = 'star';

alter table public.missions add constraint missions_icon_key_known check (icon_key in (
  'potty', 'clothes', 'toothbrush', 'food', 'cat', 'pet', 'toys', 'laundry',
  'dishes', 'bed', 'book', 'shoes', 'backpack', 'helping', 'cleaning', 'star', 'check'
));
alter table public.missions add constraint missions_name_length check (char_length(name) <= 80);
-- Normalize legacy values before adding the new supported range.
update public.missions
set repeat_cooldown_seconds = greatest(60, least(43200, repeat_cooldown_seconds))
where repeat_cooldown_seconds not between 60 and 43200;
alter table public.missions add constraint missions_cooldown_range check (repeat_cooldown_seconds between 60 and 43200);
comment on column public.missions.repeat_cooldown_seconds is
  'Seconds between awards for the same child and mission; from 60 to 43200, default 120.';

-- Child-facing missions are all repeatable. Completion snapshots retain the former
-- frequency for audit history, while awards are governed solely by the cooldown.
update public.missions set frequency = 'repeatable' where frequency <> 'repeatable';

-- Legacy emoji values remain readable but are no longer created or edited by apps.
alter table public.missions alter column emoji drop not null;
alter table public.missions alter column emoji drop default;
revoke insert (emoji), update (emoji) on public.missions from authenticated;
comment on column public.missions.emoji is
  'Legacy visual only. Preserved for compatibility; new mission visuals use icon_key.';

-- Do not backfill historical keys from today's mission: its visual may have changed.
alter table public.mission_completions add column icon_key_snapshot text;
alter table public.mission_completions add constraint completions_icon_key_known
  check (icon_key_snapshot in ('potty', 'clothes', 'toothbrush', 'food', 'cat', 'pet', 'toys', 'laundry',
  'dishes', 'bed', 'book', 'shoes', 'backpack', 'helping', 'cleaning', 'star', 'check'));
alter table public.mission_completions alter column emoji_snapshot drop not null;
alter table public.mission_completions alter column emoji_snapshot drop default;
comment on column public.mission_completions.icon_key_snapshot is
  'Stable visual key at award time. NULL only for legacy history without a key snapshot.';
comment on column public.mission_completions.emoji_snapshot is
  'Historical emoji preserved unchanged. New awards leave this column NULL.';

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
    completed_on, time_zone_snapshot, mission_name_snapshot, icon_key_snapshot,
    stars_earned, frequency_snapshot
  ) values (
    v_child.family_id, p_child_id, p_mission_id, auth.uid(), p_request_id, v_at,
    v_day, v_zone, v_mission.name, v_mission.icon_key, v_mission.stars, v_mission.frequency
  ) returning id into v_id;
  return v_id;
end;
$$;

grant insert (family_id, category_id, name, icon_key, stars, frequency, repeat_cooldown_seconds)
  on public.missions to authenticated;
grant update (category_id, name, icon_key, stars, frequency, repeat_cooldown_seconds, archived_at)
  on public.missions to authenticated;

comment on column public.missions.icon_key is
  'Validated visual key mapped to a local child-friendly icon by the app; never a filesystem path.';
commit;
