-- Authoritative Supabase setup. Do not also apply database/migrations/001_missions.sql.
-- No seeds, local-storage import, or application connection.
begin;
create schema app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and name <> ''),
  time_zone text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (created_by, request_id)
);
create table public.family_memberships (
  family_id uuid not null references public.families(id) on delete restrict,
  parent_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner', 'parent')),
  joined_at timestamptz not null default now(),
  primary key (family_id, parent_id)
);
create index memberships_by_parent on public.family_memberships(parent_id, family_id);
create table app_private.parent_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  invited_parent uuid not null references auth.users(id) on delete restrict,
  invited_by uuid not null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  foreign key (family_id, invited_by) references public.family_memberships(family_id, parent_id)
);
create table public.children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  name text not null check (name = btrim(name) and name <> ''),
  selected_reward_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (family_id, id)
);
create table public.mission_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  name text not null check (name = btrim(name) and name <> ''),
  archived_at timestamptz,
  unique (family_id, id),
  unique (family_id, name)
);
create table public.missions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  category_id uuid,
  name text not null check (name = btrim(name) and name <> ''),
  emoji text not null default '⭐' check (btrim(emoji) <> ''),
  stars integer not null check (stars > 0),
  frequency text not null check (frequency in ('once_daily', 'repeatable')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (family_id, id),
  foreign key (family_id, category_id) references public.mission_categories(family_id, id)
);
create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  name text not null check (name = btrim(name) and name <> ''),
  star_cost integer not null check (star_cost > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (family_id, id)
);
alter table public.children add constraint child_goal_same_family
  foreign key (family_id, selected_reward_id) references public.rewards(family_id, id);

create table public.mission_completions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  child_id uuid not null,
  mission_id uuid not null,
  recorded_by uuid not null,
  request_id uuid not null,
  completed_at timestamptz not null,
  completed_on date not null,
  time_zone_snapshot text not null,
  mission_name_snapshot text not null,
  emoji_snapshot text not null,
  stars_earned integer not null check (stars_earned > 0),
  frequency_snapshot text not null check (frequency_snapshot in ('once_daily', 'repeatable')),
  undone_at timestamptz,
  undone_by uuid,
  undo_request_id uuid,
  check ((undone_at is null and undone_by is null and undo_request_id is null)
      or (undone_at is not null and undone_by is not null and undo_request_id is not null)),
  unique (child_id, request_id),
  unique (child_id, undo_request_id),
  foreign key (family_id, child_id) references public.children(family_id, id),
  foreign key (family_id, mission_id) references public.missions(family_id, id),
  foreign key (family_id, recorded_by) references public.family_memberships(family_id, parent_id),
  foreign key (family_id, undone_by) references public.family_memberships(family_id, parent_id)
);
create unique index once_daily_award on public.mission_completions(child_id, mission_id, completed_on)
  where frequency_snapshot = 'once_daily' and undone_at is null;
create index completions_by_child on public.mission_completions(child_id, completed_on);
create index completions_by_family on public.mission_completions(family_id);
create table public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  child_id uuid not null,
  reward_id uuid not null,
  redeemed_by uuid not null,
  request_id uuid not null,
  redeemed_at timestamptz not null default clock_timestamp(),
  reward_name_snapshot text not null,
  stars_spent integer not null check (stars_spent > 0),
  unique (child_id, request_id),
  foreign key (family_id, child_id) references public.children(family_id, id),
  foreign key (family_id, reward_id) references public.rewards(family_id, id),
  foreign key (family_id, redeemed_by) references public.family_memberships(family_id, parent_id)
);
create index redemptions_by_family on public.reward_redemptions(family_id);

-- Definer helpers avoid recursive membership policies. No caller-supplied user ID.
create function app_private.is_member(p_family uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.family_memberships
    where family_id = p_family and parent_id = (select auth.uid()));
$$;
create function app_private.is_owner(p_family uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.family_memberships
    where family_id = p_family and parent_id = (select auth.uid()) and role = 'owner');
$$;
create function app_private.require_member(p_family uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app_private.is_member(p_family) then
    raise exception 'Family access denied' using errcode = '42501';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Star operations require READ COMMITTED isolation';
  end if;
end;
$$;
create function app_private.balance(p_child uuid) returns bigint
language sql stable set search_path = '' as $$
  select coalesce((select sum(stars_earned) from public.mission_completions
    where child_id = p_child and undone_at is null), 0)
    - coalesce((select sum(stars_spent) from public.reward_redemptions where child_id = p_child), 0);
$$;

-- Signed-in bootstrap is the only path to creating a family/owner membership.
create function public.create_family(p_name text, p_time_zone text, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_existing public.families%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'Choose an IANA time zone';
  end if;
  insert into public.families(name, time_zone, created_by, request_id)
    values (btrim(p_name), p_time_zone, auth.uid(), p_request_id)
    on conflict (created_by, request_id) do nothing returning id into v_id;
  if v_id is null then
    select * into strict v_existing from public.families
      where created_by = auth.uid() and request_id = p_request_id;
    if v_existing.name <> btrim(p_name) or v_existing.time_zone <> p_time_zone then
      raise exception 'Request ID reused with different family settings';
    end if;
    return v_existing.id;
  end if;
  insert into public.family_memberships(family_id, parent_id, role) values(v_id, auth.uid(), 'owner');
  return v_id;
end;
$$;
create function public.invite_parent(p_family_id uuid, p_parent_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app_private.is_owner(p_family_id) then raise exception 'Only the family owner may invite' using errcode = '42501'; end if;
  -- Target must already have a separate Supabase Auth account. No email lookup endpoint.
  insert into app_private.parent_invitations(family_id, invited_parent, invited_by)
    values(p_family_id, p_parent_id, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;
create function public.accept_parent_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_invite app_private.parent_invitations%rowtype;
begin
  select * into v_invite from app_private.parent_invitations
    where id = p_invitation_id and invited_parent = auth.uid() for update;
  if not found then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  if v_invite.accepted_at is not null then return v_invite.family_id; end if;
  if v_invite.expires_at <= clock_timestamp() then raise exception 'Invitation expired'; end if;
  insert into public.family_memberships(family_id, parent_id, role)
    values(v_invite.family_id, auth.uid(), 'parent') on conflict do nothing;
  update app_private.parent_invitations set accepted_at = clock_timestamp() where id = v_invite.id;
  return v_invite.family_id;
end;
$$;

-- All three financial operations lock the SAME child row before reading history.
-- Require READ COMMITTED so each statement after waiting sees the committed ledger.
create function public.award_mission(p_child_id uuid, p_mission_id uuid, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_child public.children%rowtype; v_mission public.missions%rowtype;
  v_old public.mission_completions%rowtype; v_zone text; v_at timestamptz; v_day date; v_id uuid;
begin
  select * into v_child from public.children where id = p_child_id;
  perform app_private.require_member(v_child.family_id);
  select * into strict v_child from public.children where id = p_child_id for update;
  select * into v_old from public.mission_completions where child_id = p_child_id and request_id = p_request_id;
  if found then
    if v_old.mission_id is distinct from p_mission_id or v_old.recorded_by is distinct from auth.uid() then raise exception 'Request ID reused'; end if;
    return v_old.id;
  end if;
  if v_child.archived_at is not null then raise exception 'Child is archived'; end if;
  select * into v_mission from public.missions where id = p_mission_id and family_id = v_child.family_id for share;
  if not found or v_mission.archived_at is not null then raise exception 'Mission unavailable'; end if;
  select time_zone into v_zone from public.families where id = v_child.family_id;
  v_at := clock_timestamp(); v_day := (v_at at time zone v_zone)::date;
  if v_mission.frequency = 'once_daily' and exists (
    select 1 from public.mission_completions where child_id = p_child_id and mission_id = p_mission_id
      and completed_on = v_day and undone_at is null
  ) then raise exception 'Mission already completed today'; end if;
  insert into public.mission_completions(family_id, child_id, mission_id, recorded_by, request_id,
    completed_at, completed_on, time_zone_snapshot, mission_name_snapshot, emoji_snapshot, stars_earned, frequency_snapshot)
  values(v_child.family_id, p_child_id, p_mission_id, auth.uid(), p_request_id,
    v_at, v_day, v_zone, v_mission.name, v_mission.emoji, v_mission.stars, v_mission.frequency) returning id into v_id;
  return v_id;
end;
$$;
create function public.undo_completion(p_completion_id uuid, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_event public.mission_completions%rowtype;
begin
  select * into v_event from public.mission_completions where id = p_completion_id;
  perform app_private.require_member(v_event.family_id);
  perform 1 from public.children where id = v_event.child_id for update;
  select * into strict v_event from public.mission_completions where id = p_completion_id;
  if p_request_id is null then raise exception 'Request ID required'; end if;
  if exists(select 1 from public.mission_completions where child_id = v_event.child_id
    and undo_request_id = p_request_id and id <> p_completion_id) then raise exception 'Request ID reused'; end if;
  -- An already undone event stays undone; retain the first parent's audit fields.
  if v_event.undone_at is not null then return v_event.id; end if;
  if app_private.balance(v_event.child_id) < v_event.stars_earned then
    raise exception 'Cannot undo: these stars have already been spent';
  end if;
  update public.mission_completions set undone_at = clock_timestamp(), undone_by = auth.uid(), undo_request_id = p_request_id
    where id = v_event.id;
  return v_event.id;
end;
$$;
create function public.redeem_reward(p_child_id uuid, p_reward_id uuid, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_child public.children%rowtype; v_reward public.rewards%rowtype;
  v_old public.reward_redemptions%rowtype; v_id uuid;
begin
  select * into v_child from public.children where id = p_child_id;
  perform app_private.require_member(v_child.family_id);
  select * into strict v_child from public.children where id = p_child_id for update;
  select * into v_old from public.reward_redemptions where child_id = p_child_id and request_id = p_request_id;
  if found then
    if v_old.reward_id is distinct from p_reward_id or v_old.redeemed_by is distinct from auth.uid() then raise exception 'Request ID reused'; end if;
    return v_old.id;
  end if;
  if v_child.archived_at is not null then raise exception 'Child is archived'; end if;
  select * into v_reward from public.rewards where id = p_reward_id and family_id = v_child.family_id for share;
  if not found or v_reward.archived_at is not null then raise exception 'Reward unavailable'; end if;
  if app_private.balance(p_child_id) < v_reward.star_cost then raise exception 'Not enough stars'; end if;
  insert into public.reward_redemptions(family_id, child_id, reward_id, redeemed_by, request_id, reward_name_snapshot, stars_spent)
    values(v_child.family_id, p_child_id, p_reward_id, auth.uid(), p_request_id, v_reward.name, v_reward.star_cost)
    returning id into v_id;
  return v_id;
end;
$$;

-- Invoker view uses the caller's table grants and RLS, not the view owner's privileges.
create view public.child_star_balances with (security_invoker = true) as
select c.family_id, c.id as child_id,
  coalesce((select sum(e.stars_earned) from public.mission_completions e where e.child_id = c.id and e.undone_at is null), 0)
  - coalesce((select sum(r.stars_spent) from public.reward_redemptions r where r.child_id = c.id), 0) as balance
from public.children c;

-- Explicitly enable RLS, regardless of dashboard automatic-RLS settings.
alter table public.families enable row level security;
alter table public.family_memberships enable row level security;
alter table public.children enable row level security;
alter table public.mission_categories enable row level security;
alter table public.missions enable row level security;
alter table public.rewards enable row level security;
alter table public.mission_completions enable row level security;
alter table public.reward_redemptions enable row level security;
alter table app_private.parent_invitations enable row level security;

create policy family_read on public.families for select to authenticated using (app_private.is_member(id));
create policy family_edit on public.families for update to authenticated using (app_private.is_owner(id)) with check (app_private.is_owner(id));
create policy membership_read on public.family_memberships for select to authenticated using (app_private.is_member(family_id));
create policy children_read on public.children for select to authenticated using (app_private.is_member(family_id));
create policy children_add on public.children for insert to authenticated with check (app_private.is_member(family_id));
create policy children_edit on public.children for update to authenticated using (app_private.is_member(family_id)) with check (app_private.is_member(family_id));
create policy categories_read on public.mission_categories for select to authenticated using (app_private.is_member(family_id));
create policy categories_add on public.mission_categories for insert to authenticated with check (app_private.is_member(family_id));
create policy categories_edit on public.mission_categories for update to authenticated using (app_private.is_member(family_id)) with check (app_private.is_member(family_id));
create policy missions_read on public.missions for select to authenticated using (app_private.is_member(family_id));
create policy missions_add on public.missions for insert to authenticated with check (app_private.is_member(family_id));
create policy missions_edit on public.missions for update to authenticated using (app_private.is_member(family_id)) with check (app_private.is_member(family_id));
create policy rewards_read on public.rewards for select to authenticated using (app_private.is_member(family_id));
create policy rewards_add on public.rewards for insert to authenticated with check (app_private.is_member(family_id));
create policy rewards_edit on public.rewards for update to authenticated using (app_private.is_member(family_id)) with check (app_private.is_member(family_id));
create policy completions_read on public.mission_completions for select to authenticated using (app_private.is_member(family_id));
create policy redemptions_read on public.reward_redemptions for select to authenticated using (app_private.is_member(family_id));
-- No client write policies on memberships, invitations, or history.

-- Revoke inherited/default access before selectively opting objects into the Data API.
revoke all on public.families, public.family_memberships, public.children, public.mission_categories,
  public.missions, public.rewards, public.mission_completions, public.reward_redemptions,
  public.child_star_balances from public, anon, authenticated, service_role;
revoke all on app_private.parent_invitations from public, anon, authenticated, service_role;
grant usage on schema public to authenticated;
grant select on public.families, public.family_memberships, public.children, public.mission_categories,
  public.missions, public.rewards, public.mission_completions, public.reward_redemptions,
  public.child_star_balances to authenticated;
grant update (name) on public.families to authenticated;
grant insert (family_id, name) on public.children to authenticated;
grant update (name, selected_reward_id, archived_at) on public.children to authenticated;
grant insert (family_id, name) on public.mission_categories to authenticated;
grant update (name, archived_at) on public.mission_categories to authenticated;
grant insert (family_id, category_id, name, emoji, stars, frequency) on public.missions to authenticated;
grant update (category_id, name, emoji, stars, frequency, archived_at) on public.missions to authenticated;
grant insert (family_id, name, star_cost) on public.rewards to authenticated;
grant update (name, star_cost, archived_at) on public.rewards to authenticated;

revoke all on all functions in schema app_private from public, anon, authenticated, service_role;
grant execute on function app_private.is_member(uuid), app_private.is_owner(uuid) to authenticated;
revoke all on function public.create_family(text,text,uuid), public.invite_parent(uuid,uuid),
  public.accept_parent_invitation(uuid), public.award_mission(uuid,uuid,uuid),
  public.undo_completion(uuid,uuid), public.redeem_reward(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_family(text,text,uuid), public.invite_parent(uuid,uuid),
  public.accept_parent_invitation(uuid), public.award_mission(uuid,uuid,uuid),
  public.undo_completion(uuid,uuid), public.redeem_reward(uuid,uuid,uuid) to authenticated;
comment on column public.missions.emoji is 'Parent-selected emoji; default ⭐. Future picker: ⭐ 💩 🚽 🪥 🧸 👕 🛏️ 🍽️. Always show the mission text label.';
commit;
