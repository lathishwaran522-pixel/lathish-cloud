# LATHISH VAULT

*Your Data. Your Assets. Your Control.*

A private, single-user cloud drive with a stock-exchange-terminal look. Vanilla JS front end (no build step), Vercel serverless API, Supabase (Auth + Postgres + RLS) for identity and metadata, and a **private** Backblaze B2 bucket for files. Files travel **directly between the browser and B2** over short-lived presigned URLs; they never pass through a serverless function.

**Quota: 1 GB = exactly 1,000,000,000 bytes** (decimal), enforced atomically in Postgres.

> The ticker and candlestick animations are **simulated** decoration. They are labelled as such and are not market data.

## Features
- Owner-only login (no registration), HttpOnly cookie sessions, auto-refresh, e-mail password reset, change password, sign out other sessions
- Drag-and-drop / multi-file upload queue with real byte progress, cancel, retry, duplicate-name handling; multipart for files > 64 MiB
- Folders, breadcrumbs, rename, move (dialog or drag onto a folder), favorites, grid/list, sorting, debounced search with paths, pagination
- Safe previews (images, PDF, plain text via `textContent`), download via 2-minute presigned URLs
- Trash with restore-to-original-location, permanent delete (object first, then metadata), empty trash; trash counts toward the quota
- Dashboard, Recent, Favorites, Storage Analytics, File Details, Account, Security log, custom 404/500 pages
- Keyboard navigation, focus rings, `prefers-reduced-motion`, responsive down to phones

## Layout
```
public/        static site (index, login, dashboard, 404, error, assets/) -> Vercel outputDirectory
api/           one catch-all serverless function: api/[...route].js
lib/           server code: config, router (routes.js), handlers/, supabase/, storage/, security/, validation/
supabase/      migrations/0001..0003 + setup_owner.sql
scripts/       dev-server, check-code, check-env, create-owner, find-orphans, b2-cors.json
tests/         unit/ (run anywhere), integration/ (real services, opt-in), e2e/smoke.py (browser, mocked API)
```
Only `public/` is served statically, so server code and migrations are never downloadable.

## Quick start
```bash
npm install                       # needs network: installs the AWS SDK (pinned 3.700.0)
cp .env.example .env              # fill in values (see DEPLOYMENT.md)
npm run check:env
# apply supabase/migrations/*.sql in order (SQL editor or supabase CLI)
npm run create-owner              # creates the single owner, prints OWNER_USER_ID -> put it in .env
npm run dev                       # http://localhost:3000  (APP_ORIGIN must be http://localhost:3000)
```

## Scripts
| Script | Purpose |
|---|---|
| `npm test` | unit tests (no network, no dependencies) |
| `npm run test:integration` | real Supabase + B2 tests (`RUN_INTEGRATION=1`, **test project only**) |
| `npm run lint` | syntax + security lint (no innerHTML/eval, no inline script/style, no secrets) |
| `npm run audit` | `npm audit` for production dependencies |
| `npm run check:env` | validates environment, prints names only |
| `npm run find-orphans` | lists (or `-- --delete` removes) B2 objects with no metadata and stale multipart uploads |

## Verification status (what was actually run)
Run in the build sandbox, which had **no network**:
- **Passed:** 40 unit tests (`npm test`): auth, CSRF, rate limiting, upload orchestration incl. quota, size mismatch, expiry, multipart, cleanup; validation; config; static checks of CSP/headers/migrations; code gate (`npm run lint`).
- **Passed:** headless-Chromium smoke test (`tests/e2e/smoke.py`, needs Python Playwright) with the **production CSP** and a **mocked API**: login redirect, dashboard, explorer, folder creation, upload via PUT to a mocked B2 host, context menu, analytics/security/settings pages, mobile layout; zero console/CSP errors.
- **Not run (could not be):** the SQL migrations against a real Postgres (reviewed by hand; unit tests only inspect them statically), real Supabase Auth, real B2 presigning/CORS, `npm install`/`npm audit`, a Vercel deployment. The integration tests exist for exactly these; **run them before trusting the vault with data** (DEPLOYMENT.md §7).
- The unit tests' fake database mirrors the SQL functions' contract. It proves the API logic, not the SQL. The SQL concurrency guarantee comes from a `SELECT … FOR UPDATE` on the single profile row and is checked by `tests/integration/live.test.mjs`.

## Known limits
- Empty (0-byte) files cannot be uploaded. Max file size equals the quota (1 GB); single PUT up to 64 MiB, then 32 MiB multipart parts. A failed multipart upload restarts from zero (no resume).
- Search is by filename only. No sharing links, versioning or end-to-end encryption by design.
- Vercel Hobby crons run once a day; the cleanup job is also triggered lazily when a reservation is refused for lack of space.
