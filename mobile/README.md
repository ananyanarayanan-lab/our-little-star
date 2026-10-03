# Our Little Star mobile MVP

This is a separate Expo app. It uses the same Supabase Auth, family, mission,
completion, balance, and reward data as the Vite web app. It never uses a
service-role key.

## Run on Android with Expo Go

1. Install **Expo Go** from Google Play on your Android phone.
2. Put your phone and this computer on the same Wi-Fi network.
3. Run `cd mobile` and then `npm start`.
4. Scan the QR code with Expo Go.

The local `.env` uses `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. It is ignored by Git. Restart Expo
when either value changes.

## Included

- Email/password sign-in and sign-up.
- Automatic loading for one active household.
- A scrollable grid of all active saved missions.
- One-tap `award_mission`, haptics, celebration, and Supabase-derived balance.
- Selected-reward preview and compact parent settings.

Parents can add, edit, and delete missions from Parent controls. Each
new mission earns one star and has a name (up to 80 characters), one of 17 curated
icons, and a cooldown from 1 minute to 12 hours (default: 2 minutes). Presets and
custom minutes are supported. Delete requires confirmation and hides missions from home and management. The
existing archived_at field preserves completion history and balances internally.

Apply `supabase/migrations/20260927000100_custom_missions.sql` after the earlier
migrations, including `20260921000100_repeatable_mission_cooldowns.sql`, before
using mission management. The migration preserves IDs and ledger history, makes
existing missions repeatable, and clamps legacy cooldowns to the supported range.
Cooldowns are enforced per child and mission by `award_mission`, including across
devices. Cards show Ready soon and a progress bar until they become available.

Validation: `npm test`, `npm run lint`, and `npm run build` from the repo root.
The authenticated SQL checks in `supabase/tests/invariants.sql` require a local
disposable Supabase database with all migrations applied; run them using psql
with `-v ON_ERROR_STOP=1`. They roll back fixture changes.

The approved active-membership migration must be applied before an account with
the remaining duplicate membership can open the app automatically.

## Mission visual storage

The pending custom-missions migration makes icon_key the sole current mission
visual field. Both hosted clients send only the stable key and resolve it
through mobile/missionIcons.mjs locally. Apply the follow-up
`20260927000200_mission_icon_keys_only.sql` migration immediately after it to
remove the legacy `missions.emoji` column entirely. Deploy the updated clients
with both migrations.

New award_mission calls write icon_key_snapshot and leave emoji_snapshot NULL.
Existing completion rows are not backfilled or rewritten: historical emoji
snapshots remain available for legacy history display. Editing a mission never
changes its previous completion snapshots. Migration order is cooldowns, custom
missions, then icon-keys-only.

## Parent-defined mission order

Apply `supabase/migrations/20260927000300_mission_ordering.sql` after the existing
migrations before using reorder. It adds `missions.sort_order`, backfills active
missions by their current creation order (ID breaks ties), and installs a trigger
that appends new missions in their household. No creation-form change is needed.

Hold the handle in Manage missions, drag up/down, and release to save. The sheet
auto-scrolls near its edges; Edit and Delete remain available when not dragging
or saving. Accessibility actions on the handle also move a mission up/down.
Deleted missions are excluded. Unchanged drops make no request. Changed drops
call `reorder_missions(p_family_id, p_mission_ids)` once, and the database applies
positions 10, 20, 30... atomically, updating only changed positions. A concurrent
creation/deletion invalidates an outdated list instead of silently losing a row.
Concurrent valid reorders serialize; the last committed order wins.

The RPC runs as the caller with existing RLS and additionally checks active
owner/parent membership. Inserts and reorders share a household transaction lock.
Mission IDs, completion records, cooldowns, snapshots, and balances are untouched.
Ordering is household-wide because missions currently belong to households; a
future child-specific ordering table can override this default by child/mission ID.
Both hosted clients load by sort_order, creation time, then ID, so a fresh login
or reload on any device sees the saved order. This does not add realtime syncing.

`supabase/tests/mission_ordering.sql` contains rollback-only database checks for
append defaults, ordering, no-op saves, deleted rows, ledger preservation, and
cross-household/inactive-parent rejection. Run only on a disposable local database.
