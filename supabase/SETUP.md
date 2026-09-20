# Supabase setup: Our Little Star

## What is ready, and what is unchanged

The authoritative migration is [`migrations/20260919000100_family_stars.sql`](migrations/20260919000100_family_stars.sql). It replaces the design in `database/migrations/001_missions.sql`; do not apply both. It was applied and tested on a disposable local Supabase stack on 2026-09-19. It has not been applied to a hosted Supabase project. It expects a clean application schema in a Supabase PostgreSQL 15+ database, with Supabase's existing `auth.users`, `auth.uid()`, and API roles.

The React app currently stores a child name, custom missions, multiple rewards, a balance, and completion/redemption history locally, with device-local day boundaries. It has no Supabase client connection or authentication. Database testing does not change that app storage, import records, or create a hosted project.

Use **Missions** in the app even when discussing chores in the setup. No missions, categories, or rewards are seeded. Parents explicitly create their own. Starter ideas remain optional.

## Data model

| Table or view | What it stores |
| --- | --- |
| `families` | Name, one shared IANA time zone, creating Auth parent, bootstrap retry key. |
| `family_memberships` | Separate Auth users linked to families as `owner` or `parent`. Both can manage children, missions, and rewards; only owners can invite or rename the family. |
| `children` | Editable name, optional selected reward ID, optional archive timestamp. No child login. |
| `mission_categories` | Family-specific custom category names, optionally archived. |
| `missions` | Family catalog: editable name, optional category, emoji, positive integer stars, `once_daily` or `repeatable`, optional archive timestamp. |
| `mission_completions` | Child, mission, recording parent, time, local date/time zone, mission name/emoji/frequency snapshots, actual stars earned, request ID, and optional undo audit fields. |
| `rewards` | Multiple editable family rewards with positive integer costs and optional archive timestamp. |
| `reward_redemptions` | Child, reward, parent, timestamp, reward name and cost snapshots, request ID. |
| `child_star_balances` | RLS-respecting view: non-undone completion stars minus redemption costs. No writable balance column. |
| `app_private.parent_invitations` | Targeted, seven-day invitations; not exposed through the Data API. |

Composite foreign keys include `family_id`. A child's reward goal, mission category, completion, redemption, and recorded parent must all belong to the same family. A child can have zero or one selected goal, while the family can have many rewards. Missions and rewards are family-wide catalogs available to all children in that family; per-child mission assignment is not included.

Mission emoji default to **⭐**. Future parent creation/editing should use a simple picker with options such as **⭐, 💩, 🚽, 🪥, 🧸, 👕, 🛏️, 🍽️**. Unicode text supports emoji made of multiple code points; the database rejects blank values but does not implement an emoji whitelist. Always show the text name next to the emoji, mark the adjacent decorative emoji `aria-hidden="true"`, and label picker buttons accessibly. No picker is built here.

Edits affect future events only. Archived missions/rewards cannot create new awards/redemptions, but existing history and earned/spent amounts remain. Archive instead of delete: clients receive no DELETE privileges. History has no client INSERT/UPDATE/DELETE permissions. Only the listed database operations can write it. Privileged database administrators remain able to repair data; never use that role in the browser.

## Security with your project settings

Keep **Data API enabled**, **automatically expose new tables disabled**, and **automatic RLS enabled**. Confirm `public` is an exposed schema. Keep `app_private` out of the exposed-schema list and extra search path.

The migration explicitly enables RLS on every table, revokes default permissions on its objects, and grants only the intended operations. It does not depend on automatic dashboard settings. Authenticated users can read their family rows and insert/update limited catalog/profile columns under RLS. They cannot change IDs/family ownership, directly create families, add themselves to a membership, promote themselves, or write ledger events. Anonymous users have no access. The balance view uses `security_invoker` so underlying RLS still applies.

The privileged functions have an empty `search_path`, fully qualified table names, and narrow EXECUTE grants. They use `auth.uid()` as the recording parent, not a supplied parent ID. Definer functions bypass RLS internally, so each privileged entry point explicitly checks membership, invitation ownership, or the signed-in creator. Private helper EXECUTE is limited to the two membership checks needed by policies; no direct balance or mutation-helper execution is granted.

References: Supabase's [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security), [database function security](https://supabase.com/docs/guides/database/functions), and [Data API grants](https://supabase.com/docs/guides/api/securing-your-api).

## How parents establish their family

### Choose the family's timezone during onboarding

Timezone is a per-family choice, not a hardcoded app-wide setting. Suggest the browser's detected IANA identifier using `Intl.DateTimeFormat().resolvedOptions().timeZone`, but require the parent to confirm that suggestion or choose another timezone before creating the family. If detection fails or the suggested zone is unavailable, leave the choice unselected and ask the parent to choose; do not silently fall back to New York or UTC.

Use readable labels in the selector, for example **Eastern Time — New York (America/New_York)**, **Pacific Time — Los Angeles (America/Los_Angeles)**, and **United Kingdom — London (Europe/London)**. Store the IANA identifier as the option value and submit it as `p_time_zone`; do not store the display label, a fixed UTC offset, or an abbreviation such as EST. Labels should remain understandable when daylight saving time changes the offset.

**This family's confirmed choice is Eastern Time (`America/New_York`).** Use that identifier when this family is created; do not make it the default for all families. It includes daylight saving transitions. The database already requires an explicit valid timezone in `create_family`; there is no timezone default in the Supabase migration.

Both parents' devices must use the saved `families.time_zone` for mission eligibility and displayed daily boundaries, regardless of their device timezone or travel location. The database award operation is authoritative and derives the local calendar date from its timestamp using that saved zone. New-day availability does not delete history or reset the balance. The current local-storage demo still uses the device date; changing that frontend behavior is deferred until the Supabase integration, not part of this testing task.

Timezone changes after family creation remain deferred. The second parent joins the existing family timezone rather than choosing a new one. No timezone onboarding UI is built in this database-only work.

### Create and join the family

1. Each parent signs up for a **separate Supabase Auth account** using the Auth method you choose. Never share passwords or use a child profile as a parent login.
2. The first signed-in parent calls `create_family(name, time_zone, request_id)`. It atomically creates the family and that caller's owner membership. It never accepts a creator/owner user ID. Reusing the same UUID and original payload returns the existing family.
3. The second parent signs up separately and shares their own Auth user UUID with the owner through a trusted channel. They do **not** need to create a new family.
4. The owner calls `invite_parent(family_id, second_parent_auth_uuid)`. The result is an invitation UUID, which the owner shares with the second parent. This operation sends no email.
5. The second parent, signed in as that exact user, calls `accept_parent_invitation(invitation_id)` within seven days. The database creates a `parent` membership. Other users cannot accept it, even if they know its ID. Acceptance is idempotent.

Knowing a family UUID is never enough to join. No generic `join_family(family_id)` or membership-writing API is exposed. This UUID handoff is a secure initial setup workflow, not a finished invitation UI. Email invitations, cancellation, membership removal, and ownership transfer are deferred. A new invitation can be issued after expiry. Auth account deletion is restricted while referenced by this audit history; choose a retention/anonymization policy before adding account deletion.

## Database operations for the future app connection

These are future Supabase RPC calls, not code installed in this app. Argument names must match exactly:

| Function | Parameters | Result |
| --- | --- | --- |
| `create_family` | `p_name`, `p_time_zone`, `p_request_id` | Family UUID |
| `invite_parent` | `p_family_id`, `p_parent_id` | Invitation UUID |
| `accept_parent_invitation` | `p_invitation_id` | Family UUID |
| `award_mission` | `p_child_id`, `p_mission_id`, `p_request_id` | Completion UUID |
| `undo_completion` | `p_completion_id`, `p_request_id` | Original completion UUID |
| `redeem_reward` | `p_child_id`, `p_reward_id`, `p_request_id` | Redemption UUID |

Example after a future Supabase client has been installed and the parent has signed in:

```js
// Generate once for this intentional action. Keep and reuse it on retries.
const requestId = crypto.randomUUID()
const { data, error } = await supabase.rpc('award_mission', {
  p_child_id: childId,
  p_mission_id: missionId,
  p_request_id: requestId,
})
```

Trim names before sending catalog/profile writes; database constraints require nonblank trimmed names. Omit `emoji` to use ⭐. Supply `stars` and `frequency` explicitly. Insert a child with `family_id` and `name`; update its `selected_reward_id` to a same-family reward or `null`. Selecting/changing a goal neither spends stars nor alters history. Reaching a goal means “Reward ready!” only. A parent must intentionally call `redeem_reward`; redemption is not restricted to the selected goal and does not clear it automatically.

### Concurrency, retries, and daily limits

All award, undo, and redemption RPCs acquire a row lock on the same child before reading or writing their ledger. At PostgreSQL's standard `READ COMMITTED` isolation, a waiting request reads the newly committed history after acquiring the lock. These RPCs reject other isolation levels rather than risk stale ledger snapshots. Use one RPC per request; do not create application transactions with a different isolation level.

- Two redemptions for one child serialize. The second rechecks available stars and fails if the first spent them. Awards and undo use the same lock, so they cannot race a redemption into a negative balance.
- Mission/reward rows are also locked while snapshotting their current values, so edits cannot change an event partway through recording it.
- Once-daily eligibility uses the **family's time zone** and server timestamp captured after lock acquisition, not a client-supplied date. A unique partial index is a second safeguard. Undo reopens daily eligibility. A repeatable mission accepts separate intentional requests any number of times.
- Changing a repeatable mission to once-daily counts any non-undone completion that local day. Changing it to repeatable allows additional awards. Historical amounts/frequencies remain unchanged.
- A completion or redemption request UUID is unique per child and operation type. Generate a fresh UUID for each intentional action, persist it until acknowledged, and reuse it on network retries. Successful retries return the original event even after the catalog was edited or archived. Reusing the key with a different mission/reward or recording parent is rejected. A retry of an already-undone award does not re-award it.
- Undo retains the original amount and records `undone_at`, `undone_by`, and `undo_request_id`. Repeated undo returns the original completion without subtracting again. If its stars have been spent and removing them would make the balance negative, undo is rejected. It does not erase or reverse a redemption.

Family timezone is chosen on creation and **not client-editable in this version**. This avoids timezone changes reopening today's eligibility. A future timezone-change workflow needs an explicit effective-date policy.

## Review first, then test locally

WSL 2.7.14.0 and Docker Desktop 4.91.0 (Linux Engine 29.8.0) are installed and running. Supabase CLI 2.117.0 is available through `npm exec --yes --package=supabase@2.117.0 -- supabase ...`; the app dependencies are unchanged. The PostgreSQL container supplies `psql`, so a separate Windows PostgreSQL installation is not required. Node v24.21.0 is available.

The disposable workspace is `.local-supabase-test/` (gitignored), with project ID `star-chore-local-test`, API port 55321, database port 55322, and shadow port 55320. Its generated config enables the Data API and sets `api.auto_expose_new_tables = false`. The migration explicitly enables RLS. No hosted project is linked. Optional services unrelated to these database tests are excluded from startup.

To rerun in that existing workspace on this Windows machine:

```powershell
$env:DOCKER_EXE = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe"
$env:PATH = (Split-Path $env:DOCKER_EXE) + ';' + $env:PATH
$env:DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine'
npm exec --yes --package=supabase@2.117.0 -- supabase start --workdir .local-supabase-test -x studio,imgproxy,storage-api,realtime,edge-runtime,logflare,vector,supavisor
node supabase/tests/local.mjs
```

`local.mjs` streams the SQL file as UTF-8 into the local container's `psql`, avoiding Windows PowerShell's legacy pipe encoding. It then runs the concurrency suite using separate container `psql` sessions. Container mode is restricted to `supabase_db_star-chore-local-test` through the Windows local Docker pipe; it does not use a hosted database URL. The alternative host-`psql` workflow below is still available for other development machines.

```powershell
# Initialize local CLI config once, then start a disposable local stack.
supabase init
supabase start
supabase status
```

Read the local DB URL from `supabase status`, and set `$env:LOCAL_SUPABASE_DB_URL` to it. Then apply the saved migration **only to that empty local database**:

```powershell
psql "$env:LOCAL_SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20260919000100_family_stars.sql
psql "$env:LOCAL_SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/invariants.sql
node supabase/tests/concurrency.mjs
```

Do not apply the migration twice. If the local CLI has already applied it, skip the first `psql` command. These files should be used on an empty disposable app database, not a database containing unrelated tables named `families`, `children`, etc. For the eventual hosted deployment, use your chosen migration workflow or paste the reviewed SQL into Supabase's SQL editor. Do not execute against the hosted project until the decisions below and local checks are complete. Never put a DB URL, secret/service-role key, or test JWT claim overrides in the React app.

## Checks and actual verification status

On 2026-09-19, the migration was applied to a clean, disposable local Supabase stack (`star-chore-local-test`) using Docker Desktop's local Linux engine. It was not linked to or applied against a hosted Supabase project. The local stack used API port 55321 and database port 55322. Its application tables were created with the migration and the test fixtures either rolled back or cleaned up after their run.

| Check | Status in this workspace |
| --- | --- |
| React production build and ESLint | Run; passed. |
| Node syntax check of concurrency runner | Run; passed. |
| Migration, permission, and lock-order review | Reviewed statically; not a PostgreSQL execution result. |
| Migration | Applied successfully to the disposable local Supabase database. |
| `tests/invariants.sql` | Run and passed: 49 SQL assertions covering isolation, authorization, invitations, cross-family foreign keys, Eastern Time/DST, duplicates, retries, history snapshots, undo, and redemptions. |
| `tests/concurrency.mjs` | Run and passed against the local database: competing daily awards, competing redemptions, and concurrent award/redemption retries. |
| Hosted Supabase changes | None. |

The invariant script creates temporary Auth fixtures, switches to actual `authenticated` and `anon` database roles, and asserts family isolation, forbidden membership/history writes, targeted invitation acceptance, cross-family goal/category rejection, outsider RPC denial, star constraints, no seed assignments, daily duplicates, repeatable actions/retries, snapshots, archive behavior, family-local dates, undo audit/retry, insufficient-balance undo, and redemption retries. It rolls back every fixture and fails immediately on an unexpected result.

The concurrency runner launches two separate `psql` sessions. Session A holds the child's lock after its operation; B starts while that lock is held. It checks competing daily awards, competing redemptions (10 stars cannot fund two 7-star purchases), and concurrent identical award/redemption retries. It asserts row counts and the final balance, then deletes only its own UUID-scoped fixtures as the local database owner. It refuses non-loopback hostnames and uses timeouts. An interrupted process may leave its test fixtures in the disposable database.

The SQL suite passed its Eastern Time winter/summer midnight boundaries, daylight saving transitions, required timezone selection, and the check that two parents share the same daily limit despite a different SQL session timezone. PostgreSQL emitted a harmless temporary-schema grant notice while preparing test helpers; it did not prevent role-based assertions from running. The Auth fixtures simulate database JWT claims to exercise authorization; they do not test real signup, email delivery, or browser sessions. Before production, also smoke-test two real Auth sessions through the Data API, including a third unrelated account and an anonymous request, with the intended project settings. End-to-end midnight rollover and hosted API exposure remain integration checks, not checks claimed as executed here.

## Decisions before execution

1. This family's timezone is confirmed as **Eastern Time (`America/New_York`)**. Other families must confirm a browser-suggested zone or choose another using readable labels during onboarding; there is no silent default. Auth login method/confirmation settings still need choosing.
2. Confirm family-wide mission/reward catalogs, optional categories, multiple family memberships per parent, and owner-only invitations. Per-child assignments and membership removal are not implemented.
3. Confirm the initial targeted UUID invitation handoff, or request an email invitation workflow before deployment. No one can self-enroll in an arbitrary family.
4. Confirm the undo policy: reject undo when those stars have been spent; redemption reversal/refunds are outside scope.
5. Confirm audit retention/account-deletion handling and whether the selected goal should remain after redemption (it currently does).
6. Decide how to migrate device-local balances later. Local storage contains no complete event history, so importing it needs an explicit opening-balance design; do not manufacture past completion records. No import runs now.
7. Before any hosted deployment, confirm the target is clean and only this Supabase migration will be applied. The earlier `database/` draft is superseded.
