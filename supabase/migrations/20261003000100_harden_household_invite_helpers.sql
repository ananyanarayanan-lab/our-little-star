-- Keep collision detection private to resolve_household_invite.
-- This changes privileges only; it does not modify household or history data.
begin;

revoke all on function app_private.household_has_meaningful_activity(uuid)
  from public, anon, authenticated, service_role;

commit;
