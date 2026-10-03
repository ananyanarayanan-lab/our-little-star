# Email household invitations

This feature is deliberately split between a database migration and an Edge Function. The app never contains a service-role key and never displays a household ID, parent ID, or invitation token.

## Deploy in Supabase

1. Apply these migrations in order after confirming the existing project has `pgcrypto` available in the `extensions` schema:

   - `20260921000200_email_household_invites.sql`
   - `20260921000300_household_connection_resolution.sql`
   - `20261003000100_harden_household_invite_helpers.sql`
2. Deploy the Edge Function:

   ```powershell
   supabase functions deploy send-household-invite
   ```

3. Set the Edge Function secret to the installed app deep link. Supabase supplies `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the function automatically:

   ```powershell
   supabase secrets set HOUSEHOLD_INVITE_REDIRECT_URL=ourlittlestar://invite
   ```

4. In **Authentication → URL Configuration**, add `ourlittlestar://invite` to the Redirect URLs allow list. Add the production universal-link URL too when one is configured.
5. Configure Supabase Auth email delivery. Supabase’s standard magic-link email is used to authenticate the recipient. Update the magic-link email template to say that a parent invited them to join an Our Little Star household if you want custom copy.

For Expo Go development, use a redirect URL that Supabase has explicitly allow-listed for the current Expo development URL. A standalone Android build should use `ourlittlestar://invite`.

## Flow and safeguards

- An active household owner enters an email in Parent Controls.
- The Edge Function invokes the owner-only `create_household_invite` RPC and immediately asks Supabase Auth to send a magic-link email.
- The database stores only a SHA-256 hash of a 32-byte random token; the raw token is used only in the emailed redirect URL.
- A claim requires a signed-in account whose verified Auth email matches the invited email exactly after normalization.
- Invites expire in seven days and become unusable after revocation or successful claim.
- The partial unique index permits only one active household per parent. `left_at` preserves historical membership/ledger references while removing current access.
- Existing RLS policies continue to call `app_private.is_member`; the follow-up migration changes that helper to recognize only memberships where `left_at is null`.

## Hosted verification still required

Run the migration and deploy the function in a disposable/local project first if possible, then use two real email accounts to verify: new-user sign-up, existing-user sign-in, expired/revoked/reused links, one-household rejection, and shared child/mission/reward history. Do not apply this migration to production until those checks succeed.
