-- Requires 20260927000100_custom_missions.sql. Optional operational script; not part of deployment.
-- One-time activity label update for the canonical Tiller-Narayanans household.
-- Run the entire file once in the Supabase SQL Editor.
-- Completion history is deliberately not changed: it retains its snapshots.

begin;

do $$
declare
  v_family_id constant uuid := '462cb86d-c8b0-4bcd-9bf6-4c7bb0dca8aa';
  v_rows_updated integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'our-little-star:activity-labels:' || v_family_id::text,
    0
  ));

  -- Confirm the intended household before changing its active mission labels.
  perform 1
  from public.families
  where id = v_family_id
    and name = 'Tiller-Narayanans'
  for update;

  if not found then
    raise exception 'Stopped: canonical Tiller-Narayanans household was not found.';
  end if;

  update public.missions
  set name = 'Pooped in Potty', icon_key = 'potty'
  where id = '4d217c13-65b5-4b5c-8e27-37f53f2997ff'
    and family_id = v_family_id
    and archived_at is null;

  get diagnostics v_rows_updated = row_count;
  if v_rows_updated <> 1 then
    raise exception 'Stopped: expected one active potty mission to rename.';
  end if;

  update public.missions
  set name = 'Help with Cat', icon_key = 'cat'
  where id = 'ae3cf020-9d8c-41e5-b833-313553ff886e'
    and family_id = v_family_id
    and archived_at is null;

  get diagnostics v_rows_updated = row_count;
  if v_rows_updated <> 1 then
    raise exception 'Stopped: expected one active pet-help mission to rename.';
  end if;

  -- Add exactly one separate, once-daily pee activity.
  insert into public.missions (family_id, name, icon_key, stars, frequency)
  select v_family_id, 'Pee in Potty', 'potty', 1, 'once_daily'
  where not exists (
    select 1
    from public.missions
    where family_id = v_family_id
      and name = 'Pee in Potty'
      and archived_at is null
  );
end;
$$;

select id, name, icon_key, stars, frequency
from public.missions
where family_id = '462cb86d-c8b0-4bcd-9bf6-4c7bb0dca8aa'
  and archived_at is null
order by created_at;

commit;
