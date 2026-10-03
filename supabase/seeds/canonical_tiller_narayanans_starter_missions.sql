-- Requires 20260927000100_custom_missions.sql. Optional operational script; not part of deployment.
-- One-time operational seed for the canonical Tiller-Narayanans household.
-- Run the entire file once in the Supabase SQL Editor.
-- It creates nothing when this household already has an active mission.

begin;

do $$
declare
  v_family_id constant uuid := '462cb86d-c8b0-4bcd-9bf6-4c7bb0dca8aa';
begin
  -- Serializes repeat runs of this seed script.
  perform pg_advisory_xact_lock(hashtextextended(
    'our-little-star:starter-missions:' || v_family_id::text,
    0
  ));

  -- Confirm this is the intended canonical household and lock it for the seed.
  perform 1
  from public.families
  where id = v_family_id
    and name = 'Tiller-Narayanans'
  for update;

  if not found then
    raise exception 'Stopped: canonical Tiller-Narayanans household was not found.';
  end if;

  -- Parents may customize missions later. Do not add a starter set over theirs.
  if exists (
    select 1
    from public.missions
    where family_id = v_family_id
      and archived_at is null
  ) then
    raise notice 'No starter missions added: this household already has active missions.';
    return;
  end if;

  insert into public.missions (family_id, name, icon_key, stars, frequency)
  values
    (v_family_id, 'Use the potty', 'potty', 1, 'once_daily'),
    (v_family_id, 'Get dressed', 'clothes', 1, 'once_daily'),
    (v_family_id, 'Brush teeth', 'toothbrush', 1, 'once_daily'),
    (v_family_id, 'Eat by myself', 'food', 1, 'repeatable'),
    (v_family_id, 'Help with a pet', 'pet', 1, 'once_daily'),
    (v_family_id, 'Tidy toys', 'toys', 1, 'once_daily'),
    (v_family_id, 'Help with laundry', 'laundry', 1, 'once_daily'),
    (v_family_id, 'Help with dishes', 'dishes', 1, 'once_daily');
end;
$$;

select id, name, icon_key, stars, frequency
from public.missions
where family_id = '462cb86d-c8b0-4bcd-9bf6-4c7bb0dca8aa'
  and archived_at is null
order by created_at;

commit;
