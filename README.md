# Our Little Star

A React + Vite family star app. Today and Manage Missions use local storage.
Parents can create, edit, archive, and restore missions with emoji, stars, and
once-daily or repeatable frequency. Suggestions fill a draft and are assigned only
after the parent presses Add mission. New installs start with no missions.

Manage Rewards supports multiple custom rewards, optional suggestions, editing,
archiving/restoring, one selected goal, and parent-confirmed redemption of any
available reward. Confirmation shows the name, cost, and remaining balance.
Reaching a goal never automatically redeems it. Archiving a selected reward clears
the goal; redemption leaves the selection in place. Redemption history stores the
original name, cost, and timestamp. Refunds/redemption undo are not implemented.

Existing starter missions, accumulated stars, known completions, and the previous
single reward migrate to `our-little-star-progress-v3` on the first successful
change. The previous mission, progress, and reward keys are retained as backups;
the child-name key stays unchanged. The old reward becomes the initial selected
goal. Balance, missions, rewards, and both histories are saved in one local-storage
write. Stable confirmation IDs prevent duplicate deductions, and stale confirmations
are rejected. Mission undo is blocked if spending left too few stars. New
completion records preserve the originally earned amount and remain in history
after undo or archiving. The old format stored only one day's completion IDs and
a total, so earlier detailed history cannot be reconstructed.

This remains a single-device, single-active-tab app, without parent authentication
or cross-device synchronization. Daily resets still use the device's local date;
the documented shared-family timezone onboarding is deferred to the database
integration. Parent controls are labels, not access restrictions. Failed storage
writes leave the prior state intact and show an error. Corrupt stored data is not
silently overwritten. No Supabase connection or database tools are installed.

## Development

- `npm run dev` starts Vite (reuse the existing server when it is already running).
- `npm run build` creates the production build.
- `npm run lint` checks JavaScript and React code.
- `npm run test:missions` runs the local mission-logic and migration checks.
- `npm test` runs all 18 mission/reward logic checks, including redemption and undo after spending.

## Database preparation

See [the Supabase setup guide](supabase/SETUP.md) and
[the saved migration](supabase/migrations/20260919000100_family_stars.sql).
The earlier `database/` draft is superseded; do not apply both.

The new database model supports parent-created **Missions**, parent-selected emoji
(default ⭐), positive whole-number star values, once-daily or repeatable frequency,
editing, archiving, and completion history with original star awards preserved.
It also supports Auth-linked family memberships, family isolation with RLS,
multiple rewards, audit-preserving redemptions and undo, and ledger-derived balances.
It assigns no starter missions; suggestions will be optional.

The migration is not connected to the current browser app. Authentication,
database import, and database-backed redemption remain future work. The saved
Supabase migration passed its local disposable-stack invariants and concurrency
tests; it has not been applied to hosted Supabase. Local mission-logic tests are
separate from the database suites.

## Hosted Supabase authentication

The app now uses Supabase email/password authentication to protect the local
prototype. It does not yet read or write family, mission, reward, or balance data
to Supabase; current browser local-storage data is not removed or imported.

Copy [.env.example](.env.example) to a new `.env.local` file in the project root,
then paste the hosted project URL and **publishable key**:

```powershell
Copy-Item .env.example .env.local
```

Restart the Vite dev server after saving `.env.local`. Vite only reads `VITE_`
variables when it starts. `.env.local` is ignored by Git. Do not use, paste, or
commit a Supabase service-role key; it belongs only in trusted server-side code.

Use the project’s API URL in this exact base form: `https://your-project-ref.supabase.co`.
Do not append `/rest/v1`, `/auth/v1`, a trailing path, a query string, or a fragment.
Supabase JS builds its own Auth endpoint (`/auth/v1`) for sign-in and its own Data
API endpoint (`/rest/v1`) for database calls. The startup screen reports only whether
each value is present and whether the URL shape is valid; it never displays values.

After signing in, the app loads a read-only **Shared family data** panel from the
signed-in parent’s Supabase memberships. A parent without a membership sees family
onboarding and can create one family plus its first child. The browser-detected
timezone is suggested but must be explicitly confirmed. The existing Missions and
Rewards UI remains labeled **Local prototype — this browser only** and is not
imported, overwritten, or merged with Supabase data.

## Publish to GitHub Pages

The included workflow, [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml),
builds the app for GitHub Pages and deploys it after a push to the main branch.
It uses the repository name as Vite’s production base path, so an app in a
repository named little-star will load correctly at
https://USERNAME.github.io/little-star/. Local development continues to use /.

1. On GitHub, create a new **public** repository. Do not add a README or starter
   files if GitHub offers that option.
2. In this project folder, initialize Git if needed, add the existing files,
   commit them, add the GitHub repository as origin, and push your branch as
   main.
3. In the GitHub repository, open **Settings → Secrets and variables → Actions**.
   Add these repository secrets:
   - VITE_SUPABASE_URL — the project API base URL, such as
     https://your-project-ref.supabase.co
   - VITE_SUPABASE_PUBLISHABLE_KEY — the project publishable key
4. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
5. Push to main, then open the **Actions** tab and wait for “Deploy to GitHub
   Pages” to finish. Copy the Pages URL shown by that deployment.
6. In Supabase, open **Authentication → URL Configuration**. Add the copied Pages
   URL to the allowed redirect URLs before relying on email confirmation or
   password-reset links.

Never add a service-role key to GitHub secrets used by this app, .env.local, or
client-side code. The workflow uses only the two browser-safe values listed above.
.env.local is already ignored by Git.
