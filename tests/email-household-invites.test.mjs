import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260921000200_email_household_invites.sql', import.meta.url)
const connectionMigration = new URL('../supabase/migrations/20260921000300_household_connection_resolution.sql', import.meta.url)
const mobileApp = new URL('../mobile/App.js', import.meta.url)
const edgeFunction = new URL('../supabase/functions/send-household-invite/index.ts', import.meta.url)
const inviteHelpers = new URL('../mobile/householdInvites.mjs', import.meta.url)
const hardeningMigration = new URL('../supabase/migrations/20261003000100_harden_household_invite_helpers.sql', import.meta.url)
const expiryFixMigration = new URL('../supabase/migrations/20261003000200_fix_household_invite_expiry_ambiguity.sql', import.meta.url)

test('email household invites are hashed, single-use, email-bound, and expire', async () => {
  const source = await readFile(migration, 'utf8')
  assert.match(source, /token_hash bytea not null unique/)
  assert.match(source, /expires_at timestamptz not null/)
  assert.match(source, /claimed_at timestamptz/)
  assert.match(source, /revoked_at timestamptz/)
  assert.match(source, /extensions\.digest\(p_token, 'sha256'\)/)
  assert.match(source, /v_email <> v_invite\.email_normalized/)
  assert.match(source, /already belongs to a household/)
})

test('active membership alone grants household access and one active household is enforced', async () => {
  const source = await readFile(migration, 'utf8')
  assert.match(source, /one_active_household_per_parent/)
  assert.match(source, /left_at is null/)
  assert.match(source, /create or replace function app_private\.is_member/)
  assert.match(source, /create or replace function app_private\.is_owner/)
})

test('the mobile client sends an email through the Edge Function and never exposes raw identifiers', async () => {
  const [app, edge] = await Promise.all([readFile(mobileApp, 'utf8'), readFile(edgeFunction, 'utf8')])
  assert.match(app, /send-household-invite/)
  assert.match(app, /resolve_household_invite/)
  assert.equal(app.includes('invite_parent'), false)
  assert.equal(app.includes('accept_parent_invitation'), false)
  assert.match(edge, /signInWithOtp/)
  assert.match(edge, /create_household_invite/)
  assert.match(edge, /revoke_household_invite/)
  assert.match(edge, /errorCode/)
  assert.equal(edge.includes('SUPABASE_SERVICE_ROLE_KEY'), false)
  assert.doesNotMatch(edge, /Response\.json\(\{ error: error instanceof Error \? error\.message/)
})

test('handled invite failures use friendly messages without React Native overlay logging', async () => {
  const { householdInviteError, householdInviteSendError } = await import(inviteHelpers)
  assert.equal(householdInviteError({ message: 'This invitation has expired' }), 'This invite has expired.')
  assert.equal(householdInviteError({ message: 'This invitation has already been used' }), 'This invite has already been used.')
  assert.equal(householdInviteError({ message: 'This invitation was sent to a different email address' }), 'This invite was sent to a different email address.')
  assert.equal(householdInviteError({ message: 'column private_table does not exist' }), 'Something went wrong. Please try again.')
  assert.equal(householdInviteSendError('duplicate_invite'), 'An invite is already waiting for this email address.')
  const source = await readFile(inviteHelpers, 'utf8')
  assert.doesNotMatch(source, /console\.(error|warn)/)
})

test('all shared household tables remain protected by active-membership RLS', async () => {
  const [base, email] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260919000100_family_stars.sql', import.meta.url), 'utf8'),
    readFile(migration, 'utf8'),
  ])
  for (const table of ['families', 'family_memberships', 'children', 'missions', 'mission_completions', 'rewards', 'reward_redemptions']) {
    assert.match(base, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  assert.match(email, /parent_id = \(select auth\.uid\(\)\) and left_at is null/)
  assert.match(email, /revoke all on app_private\.household_invites/)
})

test('existing-household invite resolution preserves history and requires explicit empty-household confirmation', async () => {
  const source = await readFile(connectionMigration, 'utf8')
  assert.match(source, /household_connection_requests/)
  assert.match(source, /household_has_meaningful_activity/)
  assert.match(source, /outcome := 'confirm_empty_switch'/)
  assert.match(source, /outcome := 'manual_merge_required'/)
  assert.match(source, /p_confirm_empty_switch boolean default false/)
  assert.match(source, /set left_at = clock_timestamp\(\)/)
  assert.match(source, /insert into public\.family_memberships/)
  assert.doesNotMatch(source, /delete from public\.(families|children|missions|mission_completions|rewards|reward_redemptions)/i)
})

test('private invite and collision objects are not directly exposed to clients', async () => {
  const [email, connection, hardening] = await Promise.all([
    readFile(migration, 'utf8'), readFile(connectionMigration, 'utf8'), readFile(hardeningMigration, 'utf8'),
  ])
  assert.match(email, /revoke all on app_private\.household_invites from public, anon, authenticated, service_role/)
  assert.match(connection, /revoke all on app_private\.household_connection_requests from public, anon, authenticated, service_role/)
  assert.match(hardening, /revoke all on function app_private\.household_has_meaningful_activity\(uuid\)/)
  assert.doesNotMatch(hardening, /\b(update|insert|delete)\b/i)
})

test('invite creation qualifies the expiry column instead of colliding with its return field', async () => {
  const source = await readFile(expiryFixMigration, 'utf8')
  assert.match(source, /from app_private\.household_invites as hi/)
  assert.match(source, /hi\.expires_at > clock_timestamp\(\)/)
  assert.match(source, /return query select v_invitation_id, v_token, v_expires/)
  assert.doesNotMatch(source, /\b(delete|update)\s+public\.(families|children|missions|mission_completions|rewards|reward_redemptions)/i)
})
