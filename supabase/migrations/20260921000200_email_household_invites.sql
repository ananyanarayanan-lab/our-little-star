-- Secure, email-bound household invitations. Apply after the original family-stars migration.
-- This migration preserves historical membership and ledger rows; left_at only controls access.
begin;

alter table public.family_memberships add column if not exists left_at timestamptz;
create unique index if not exists one_active_household_per_parent
  on public.family_memberships(parent_id) where left_at is null;

-- Existing RLS policies call these helpers, so changing the helpers makes inactive
-- memberships lose access without modifying historical foreign-key references.
create or replace function app_private.is_member(p_family uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.family_memberships
    where family_id = p_family and parent_id = (select auth.uid()) and left_at is null);
$$;
create or replace function app_private.is_owner(p_family uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.family_memberships
    where family_id = p_family and parent_id = (select auth.uid())
      and role = 'owner' and left_at is null);
$$;

create table app_private.household_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  email_normalized text not null check (email_normalized = lower(btrim(email_normalized)) and email_normalized <> ''),
  token_hash bytea not null unique,
  invited_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  claimed_at timestamptz,
  claimed_by uuid,
  check ((claimed_at is null and claimed_by is null) or (claimed_at is not null and claimed_by is not null)),
  foreign key (family_id, invited_by) references public.family_memberships(family_id, parent_id)
);
create index household_invites_lookup on app_private.household_invites(token_hash);
create index household_invites_family_email on app_private.household_invites(family_id, email_normalized);
alter table app_private.household_invites enable row level security;
revoke all on app_private.household_invites from public, anon, authenticated, service_role;

create or replace function public.create_family(p_name text, p_time_zone text, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_existing public.families%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if exists(select 1 from public.family_memberships where parent_id = auth.uid() and left_at is null) then
    raise exception 'This account already belongs to a household';
  end if;
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

-- The raw token is returned once to the trusted Edge Function, which immediately
-- embeds it in the Auth email redirect URL. Only its SHA-256 digest is stored.
create function public.create_household_invite(p_family_id uuid, p_email text)
returns table(invitation_id uuid, invite_token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email)); v_token text; v_hash bytea; v_expires timestamptz;
begin
  if not app_private.is_owner(p_family_id) then raise exception 'Only the household owner may invite a parent' using errcode = '42501'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
  if exists(select 1 from app_private.household_invites where family_id = p_family_id and email_normalized = v_email
    and revoked_at is null and claimed_at is null and expires_at > clock_timestamp()) then
    raise exception 'An active invitation has already been sent to this email';
  end if;
  v_token := translate(trim(trailing '=' from encode(extensions.gen_random_bytes(32), 'base64')), '+/', '-_');
  v_hash := extensions.digest(v_token, 'sha256');
  v_expires := clock_timestamp() + interval '7 days';
  insert into app_private.household_invites(family_id, email_normalized, token_hash, invited_by, expires_at)
    values(p_family_id, v_email, v_hash, auth.uid(), v_expires) returning id into invitation_id;
  invite_token := v_token; expires_at := v_expires;
  return next;
end;
$$;

create function public.revoke_household_invite(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_invite app_private.household_invites%rowtype;
begin
  select * into v_invite from app_private.household_invites where id = p_invitation_id for update;
  if not found or not app_private.is_owner(v_invite.family_id) then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  if v_invite.claimed_at is not null then raise exception 'A claimed invitation cannot be revoked'; end if;
  update app_private.household_invites set revoked_at = clock_timestamp() where id = p_invitation_id and revoked_at is null;
end;
$$;

create function public.claim_household_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_invite app_private.household_invites%rowtype; v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'Sign in before accepting this invitation' using errcode = '42501'; end if;
  if p_token !~ '^[A-Za-z0-9_-]{43}$' then raise exception 'This invitation link is invalid'; end if;
  select * into v_invite from app_private.household_invites where token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found then raise exception 'This invitation link is invalid'; end if;
  if v_invite.revoked_at is not null then raise exception 'This invitation has been revoked'; end if;
  if v_invite.expires_at <= clock_timestamp() then raise exception 'This invitation has expired'; end if;
  if v_invite.claimed_at is not null then raise exception 'This invitation has already been used'; end if;
  if v_email <> v_invite.email_normalized then raise exception 'This invitation was sent to a different email address' using errcode = '42501'; end if;
  if exists(select 1 from public.family_memberships where parent_id = auth.uid() and left_at is null) then
    raise exception 'This account already belongs to a household';
  end if;
  insert into public.family_memberships(family_id, parent_id, role) values(v_invite.family_id, auth.uid(), 'parent');
  update app_private.household_invites set claimed_at = clock_timestamp(), claimed_by = auth.uid() where id = v_invite.id;
  return v_invite.family_id;
end;
$$;

-- Legacy UUID invitation endpoints remain for audit compatibility but are unreachable to clients.
revoke execute on function public.invite_parent(uuid, uuid), public.accept_parent_invitation(uuid) from authenticated;
revoke all on function public.create_household_invite(uuid, text), public.claim_household_invite(text), public.revoke_household_invite(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_household_invite(uuid, text), public.claim_household_invite(text), public.revoke_household_invite(uuid) to authenticated;

commit;
