# Mission database setup

> **Superseded draft. Do not execute these instructions.** Use [the Supabase setup guide](../supabase/SETUP.md) and its migration instead. This earlier private-schema proposal is retained for reference only; do not apply both designs.

This is a preparatory PostgreSQL 15+ migration. It is not connected to the React app, and no hosted database has been created or modified. The current app still uses local storage and its original demo missions. No mission-management UI, emoji picker, authentication, or redemption is implemented here.

## Apply to an empty development database

Use a UTF-8 PostgreSQL database and its owner/migration account. From the project root, with `DATABASE_URL` set in your shell:

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/migrations/001_missions.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/missions.sql
```

The migration creates the private `star_app` schema in one transaction. Apply it once and track its version; future changes should use new numbered migrations. The tests roll back their fixtures. PostgreSQL and `psql` are not bundled with this app.

This schema also uses standard PostgreSQL features available in Supabase, but it deliberately has no `auth.users` dependency yet. Do not expose `star_app` through a browser-facing API. Before connecting the app, implement authenticated parent ownership checks (or reviewed RLS policies), restricted backend grants, and a link between `children.parent_id` and the chosen authentication system. Never put database credentials or a service-role key in Vite/client code. No client grants or policies are supplied by this migration.

## Records and rules

| Record | Purpose |
| --- | --- |
| `children` | Parent identifier, child name, and an explicit IANA time zone for daily boundaries. Set the family's real zone at creation; the default is `America/New_York`. |
| `missions` | Parent-created name, positive integer `stars`, chosen `frequency`, `emoji`, and optional `archived_at`. Each mission belongs to one child. |
| `mission_completions` | Permanent event with snapshots of the name, emoji, frequency, time zone, and stars awarded. Includes an optional undo timestamp. |
| `star_balances` | Sum of non-undone award snapshots per child, including awards from archived missions. |

Use **Missions** in all user-facing labels. Parents choose mission names, star values, and either `once_daily` or `repeatable`; neither stars nor frequency is silently assigned. No starter missions are inserted. Suggestions such as brushing teeth or putting toys away are optional ideas for the future creation form, not assignments.

`emoji` is non-null Unicode text, defaults to **⭐**, and rejects empty values. Text is intentional: emoji such as **🍽️** can contain multiple Unicode code points. The future creation/editing form should offer a simple picker, including **⭐, 💩, 🚽, 🪥, 🧸, 👕, 🛏️, 🍽️**. The database does not attempt to validate Unicode grapheme sequences; the picker will supply the supported choices. Always display the chosen emoji alongside the visible mission name. Treat that adjacent emoji as decorative (`aria-hidden="true"`); give picker buttons accessible names such as “Toothbrush” or “Teddy bear.” Do not build the picker in this change.

Edits to name, emoji, stars, and frequency apply only to future completions. Archive by setting `archived_at`; archive hides a mission from the active list and blocks new awards, but retains every old completion and earned star. Clearing `archived_at` restores it. Mission deletion is rejected, and child deletion is restricted when missions exist.

Daily eligibility uses the child's stored time zone, not UTC. Once-daily means one non-undone completion on that calendar date. Repeatable allows multiple intentional completions. Switching a previously completed repeatable mission to once-daily prevents another award that day; switching to repeatable permits new awards. Undo permits another completion and subtracts exactly the original award, even after editing or archiving. Changing the child's time zone does not rewrite historical calendar dates.

## Backend operations for the future integration

These examples are SQL shapes, not browser queries. The backend must first verify that the authenticated parent owns the child/mission/completion. Use parameterized queries.

```sql
-- Parent explicitly supplies stars and frequency; omitted emoji becomes ⭐.
INSERT INTO star_app.missions (child_id, name, stars, frequency, emoji)
VALUES ($1, btrim($2), $3, $4, $5) RETURNING *;

UPDATE star_app.missions
SET name = btrim($2), stars = $3, frequency = $4, emoji = $5
WHERE id = $1 RETURNING *;

UPDATE star_app.missions SET archived_at = now() WHERE id = $1;

-- The trigger supplies child, date, and all snapshots from the locked mission.
INSERT INTO star_app.mission_completions (mission_id, request_id)
VALUES ($1, $2) RETURNING *;

-- Parent-only undo is idempotent and preserves the historical award.
UPDATE star_app.mission_completions SET undone_at = now()
WHERE id = $1 AND undone_at IS NULL;

SELECT balance FROM star_app.star_balances WHERE child_id = $1;
```

Generate a fresh `request_id` UUID for each intentional completion, and reuse it for network retries. A unique constraint prevents a repeatable mission from earning twice on a retried request. The backend should look up and return an existing, authorized event by request ID before retrying, and re-read it after an insert conflict. Verify it belongs to the requested mission. Do not blindly retry with a new UUID. The trigger locks the mission row during award creation; mission edits use that same row lock. A partial unique index additionally enforces the once-daily constraint. See PostgreSQL's [partial index documentation](https://www.postgresql.org/docs/17/indexes-partial.html).

Local-storage balances are not imported or cleared. Plan a separate explicit migration for existing device data before switching storage; the current browser records do not contain full historical events, so do not invent past completions. Reward configuration and redemption are outside this migration. Reaching a reward goal must not automatically spend stars.
