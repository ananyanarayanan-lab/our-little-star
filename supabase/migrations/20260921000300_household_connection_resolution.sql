-- Resolve an email invitation without deleting households or ledger history.
-- Requires 20260921000200_email_household_invites.sql.
begin;

create table app_private.household_connection_requests (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references app_private.household_invites(id) on delete restrict,
  inviting_family_id uuid not null references public.families(id) on delete restrict,
  existing_family_id uuid not null references public.families(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null check (status = 'manual_merge_required'),
  created_at timestamptz not null default clock_timestamp(),
  unique (invitation_id, requested_by)
);
alter table app_private.household_connection_requests enable row level security;
revoke all on app_private.household_connection_requests from public, anon, authenticated, service_role;

-- A household is meaningful only when its star/reward ledger contains activity.
-- Plain setup records are preserved either way; they are never deleted or copied.
create function app_private.household_has_meaningful_activity(p_family_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.mission_completions where family_id = p_family_id)
      or exists(select 1 from public.reward_redemptions where family_id = p_family_id);
$$;

-- Returns a UI-safe household name and outcome, never a family/member/token identifier.
-- p_confirm_empty_switch is false for the first claim and true only after the
-- invited parent explicitly confirms leaving an empty current household.
create function public.resolve_household_invite(p_token text, p_confirm_empty_switch boolean default false)
returns table(outcome text, household_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_invite app_private.household_invites%rowtype;
  v_current public.family_memberships%rowtype;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_inviting_name text;
begin
  if auth.uid() is null then raise exception 'Sign in before accepting this invitation' using errcode = '42501'; end if;
  if p_token !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'This invitation link is invalid'; end if;
  select * into v_invite from app_private.household_invites
    where token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found then raise exception 'This invitation link is invalid'; end if;
  if v_invite.revoked_at is not null then raise exception 'This invitation has been revoked'; end if;
  if v_invite.expires_at <= clock_timestamp() then raise exception 'This invitation has expired'; end if;
  if v_invite.claimed_at is not null then raise exception 'This invitation has already been used'; end if;
  if v_email <> v_invite.email_normalized then raise exception 'This invitation was sent to a different email address' using errcode = '42501'; end if;
  select name into v_inviting_name from public.families where id = v_invite.family_id;

  -- Lock the invitee's one active membership before deciding whether to switch.
  select * into v_current from public.family_memberships
    where parent_id = auth.uid() and left_at is null for update;

  if not found then
    insert into public.family_memberships(family_id, parent_id, role)
      values(v_invite.family_id, auth.uid(), 'parent');
    update app_private.household_invites set claimed_at = clock_timestamp(), claimed_by = auth.uid() where id = v_invite.id;
    outcome := 'joined'; household_name := v_inviting_name; return next; return;
  end if;

  if v_current.family_id = v_invite.family_id then
    outcome := 'already_member'; household_name := v_inviting_name; return next; return;
  end if;

  -- Never deactivate a membership whose current household has ledger activity.
  -- In the common case the inviting household is meaningful; that alone must
  -- not block a parent from leaving their own truly empty household.
  if app_private.household_has_meaningful_activity(v_current.family_id) then
    insert into app_private.household_connection_requests(invitation_id, inviting_family_id, existing_family_id, requested_by, status)
      values(v_invite.id, v_invite.family_id, v_current.family_id, auth.uid(), 'manual_merge_required')
      on conflict (invitation_id, requested_by) do nothing;
    outcome := 'manual_merge_required'; household_name := v_inviting_name; return next; return;
  end if;

  if not p_confirm_empty_switch then
    outcome := 'confirm_empty_switch'; household_name := v_inviting_name; return next; return;
  end if;

  -- Preserve the old household and all historical references. Only deactivate
  -- this parent's access before atomically creating the new active membership.
  update public.family_memberships set left_at = clock_timestamp()
    where family_id = v_current.family_id and parent_id = auth.uid() and left_at is null;
  insert into public.family_memberships(family_id, parent_id, role)
    values(v_invite.family_id, auth.uid(), 'parent');
  update app_private.household_invites set claimed_at = clock_timestamp(), claimed_by = auth.uid() where id = v_invite.id;
  outcome := 'joined_after_empty_switch'; household_name := v_inviting_name; return next;
end;
$$;

revoke all on function public.resolve_household_invite(text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.resolve_household_invite(text, boolean) to authenticated;

commit;
