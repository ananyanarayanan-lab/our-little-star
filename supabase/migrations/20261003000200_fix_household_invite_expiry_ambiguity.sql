-- Fix an output-column name collision in create_household_invite.
-- This changes only the RPC definition; it does not modify invitation or household data.
begin;

create or replace function public.create_household_invite(p_family_id uuid, p_email text)
returns table(invitation_id uuid, invite_token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_token text;
  v_hash bytea;
  v_expires timestamptz;
  v_invitation_id uuid;
begin
  if not app_private.is_owner(p_family_id) then
    raise exception 'Only the household owner may invite a parent' using errcode = '42501';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if exists (
    select 1
    from app_private.household_invites as hi
    where hi.family_id = p_family_id
      and hi.email_normalized = v_email
      and hi.revoked_at is null
      and hi.claimed_at is null
      and hi.expires_at > clock_timestamp()
  ) then
    raise exception 'An active invitation has already been sent to this email';
  end if;

  v_token := translate(trim(trailing '=' from encode(extensions.gen_random_bytes(32), 'base64')), '+/', '-_');
  v_hash := extensions.digest(v_token, 'sha256');
  v_expires := clock_timestamp() + interval '7 days';

  insert into app_private.household_invites(
    family_id, email_normalized, token_hash, invited_by, expires_at
  ) values (
    p_family_id, v_email, v_hash, auth.uid(), v_expires
  ) returning id into v_invitation_id;

  return query select v_invitation_id, v_token, v_expires;
end;
$$;

revoke all on function public.create_household_invite(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_household_invite(uuid, text) to authenticated;

commit;
