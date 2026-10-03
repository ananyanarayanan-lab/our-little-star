-- One-time label-only update for the canonical Tiller-Narayanans household.
-- Run this file once in the Supabase SQL Editor to persist the shorter labels.
-- It does not change icons, star values, cooldowns, or completion history.
begin;

do $$
declare
  v_family_id constant uuid := '462cb86d-c8b0-4bcd-9bf6-4c7bb0dca8aa';
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'our-little-star:short-activity-labels:' || v_family_id::text,
    0
  ));

  perform 1
  from public.families
  where id = v_family_id and name = 'Tiller-Narayanans'
  for update;

  if not found then
    raise exception 'Stopped: canonical Tiller-Narayanans household was not found.';
  end if;

  update public.missions
  set name = case name
    when 'Pooped in Potty' then 'Poop in potty'
    when 'Pee in Potty' then 'Pee in potty'
    when 'Help with laundry' then 'Laundry'
    when 'Help with dishes' then 'Dishes'
    else name
  end
  where family_id = v_family_id
    and archived_at is null
    and name in ('Pooped in Potty', 'Pee in Potty', 'Help with laundry', 'Help with dishes');
end;
$$;

select id, name, emoji, stars, frequency
from public.missions
where family_id = '462cb86d-c8b0-4bcd-9bf6-4c7bb0dca8aa'
  and archived_at is null
order by created_at;

commit;
