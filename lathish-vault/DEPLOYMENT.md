# Deployment

Nothing here was executed against live services by the author's tooling (no network). Follow §7 to verify your own deployment before storing data.

## 1. Local development
```bash
npm install
cp .env.example .env     # edit: APP_ORIGIN=http://localhost:3000 for local use
npm run check:env
npm run dev              # http://localhost:3000, applies the production security headers
npm test && npm run lint
```
Apply migrations and create the owner (§2) first, or login will not work.

## 2. Supabase
1. New project. Copy **Project URL**, the **publishable/anon key**, and the **service-role (secret) key** into `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. SQL editor: run `supabase/migrations/0001_schema.sql`, `0002_functions.sql`, `0003_rls.sql` in order (or `supabase db push`). 0003 enables and forces RLS on every table and locks functions to `service_role`.
3. Create the owner: `npm run create-owner` (reads `.env`, prompts for a 12+ char password, creates a confirmed Auth user and the `vault_profile` row, prints `OWNER_USER_ID`). Manual alternative: `supabase/setup_owner.sql`. Put `OWNER_USER_ID` and `OWNER_EMAIL` in the environment.
4. Authentication settings: **disable "Allow new users to sign up"**; set minimum password length ≥ 12; JWT expiry 3600 s; enable refresh-token rotation and time-boxed sessions if your plan allows; Site URL = your `APP_ORIGIN`; add `${APP_ORIGIN}/login.html` to Redirect URLs (the reset e-mail returns there).
5. Optionally configure custom SMTP so reset e-mails are reliable.

## 3. Backblaze B2
1. Create a **private** bucket. Note its name (`B2_BUCKET`) and the S3 endpoint shown for its region, e.g. `https://s3.us-west-004.backblazeb2.com` (`B2_ENDPOINT`).
2. App Keys → Add: **restricted to this bucket**, read+write; needs list/read/write/delete file capabilities (multipart upload/abort and object delete included). Copy `keyID` → `B2_KEY_ID`, `applicationKey` → `B2_APPLICATION_KEY` (shown once).
3. CORS (required for direct browser transfers). Edit `scripts/b2-cors.json` and set `allowedOrigins` to your exact production origin, then with the B2 CLI:
   `b2 bucket update --cors-rules "$(cat scripts/b2-cors.json)" YOUR_BUCKET allPrivate`
   (or the bucket's CORS settings page). The rules must allow `PUT`, `GET`, `HEAD`, any request header (the preview uses `Range`), and expose `ETag`. Keep the bucket **allPrivate**.
4. The SDK is pinned to 3.700.0 on purpose: newer AWS SDK releases add default checksum headers that B2's S3 API rejected.

## 4. Vercel
1. Push this repo to GitHub, then **Add New Project → import**. Framework preset **Other**; `vercel.json` already sets `outputDirectory: public`, no build command, `maxDuration: 60` and the daily cron.
2. Environment Variables (Production), all server-side: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OWNER_USER_ID`, `OWNER_EMAIL`, `B2_ENDPOINT`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `APP_ORIGIN` (exact `https://…`, no trailing slash), `CRON_SECRET` (≥ 32 random chars, e.g. `openssl rand -hex 32`), optional `BLOCKED_EXTENSIONS`.
3. Deploy, then add your domain (Settings → Domains) and make sure `APP_ORIGIN`, the Supabase Site URL and the B2 CORS origin all equal it. Redeploy after changing env vars.
4. Cron: Vercel sends `Authorization: Bearer $CRON_SECRET` to `/api/storage/cleanup` daily at 03:00 UTC (Hobby allows once per day).

## 5. Environment variables
| Variable | Secret? | Purpose |
|---|---|---|
| SUPABASE_URL | no (server only) | project URL |
| SUPABASE_ANON_KEY | low (server only) | password grant / recover calls |
| SUPABASE_SERVICE_ROLE_KEY | **yes** | RPC calls; bypasses RLS |
| OWNER_USER_ID, OWNER_EMAIL | no | the only identity allowed in |
| B2_ENDPOINT, B2_BUCKET | no | storage location |
| B2_KEY_ID | semi | key id |
| B2_APPLICATION_KEY | **yes** | signs URLs |
| APP_ORIGIN | no | CSRF/Origin check, cookie flags, reset redirect |
| CRON_SECRET | **yes** | authorises the cleanup cron |
| BLOCKED_EXTENSIONS | no | refused upload extensions (default `scr,pif,vbs,bat,cmd,com`) |

None is exposed to the browser; there are no `NEXT_PUBLIC_`/`VITE_` variables.

## 6. Production smoke test
Sign in; check the sidebar shows `/ 1 GB`; upload a small file and a > 64 MiB file; download both; rename, move, trash, restore, permanently delete; confirm usage returns to 0. Open `https://YOUR_DOMAIN/lib/config.js` and `/supabase/migrations/0001_schema.sql`: both must 404. Check headers at securityheaders.com.

## 7. Verify with real services (do this once, in a TEST project/bucket)
```bash
RUN_INTEGRATION=1 npm run test:integration
python3 tests/e2e/smoke.py     # optional browser check (pip install playwright)
```
The first test fires six concurrent reservations and asserts exactly one fits; the second performs a presigned PUT/HEAD/GET/DELETE round trip and checks that the bucket refuses unsigned reads.

## 8. Maintenance
- **Backups:** Supabase backups (plan dependent) plus a periodic `pg_dump` of `public.nodes`, `vault_profile`, `usage_snapshots`. File bytes live only in B2; B2 lifecycle/versioning is your choice. **Test a restore**: load the dump into a scratch project and confirm `recompute_usage` matches.
- **Orphans/expired uploads:** `npm run find-orphans` (dry run), `-- --delete` to remove objects/multipart uploads older than 48 h with no metadata. The daily cron already expires abandoned sessions.
- **Rotate credentials:** SECURITY.md. **Audit dependencies:** `npm run audit` regularly; the only runtime dependencies are the two pinned AWS SDK packages.

## 9. Troubleshooting
| Symptom | Likely cause |
|---|---|
| 500 `server_misconfigured` | missing/invalid env var: run `npm run check:env`, check Vercel logs (names only) |
| Login always "Invalid email or password" | `OWNER_USER_ID`/`OWNER_EMAIL` mismatch, user unconfirmed, or sign-in disabled |
| 403 `forbidden_origin` | `APP_ORIGIN` differs from the address in the browser (scheme/host/port) |
| Upload stalls / CORS error in console | B2 CORS origin wrong or missing PUT/headers |
| 403 from B2 on PUT | `Content-Type` mismatch, expired URL, or key lacks write capability |
| Text preview fails | CORS must allow the `Range` header (use `allowedHeaders: ["*"]`) |
| "Storage limit reached" with free space | abandoned reservations: wait for cleanup or call `/api/storage/cleanup` with the cron secret; Analytics → Recompute usage |
| Reset link lands on login with an error | Redirect URL not allow-listed in Supabase |
