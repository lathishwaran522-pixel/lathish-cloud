# Architecture

```
Browser (public/, vanilla ES modules)
   |  same-origin fetch, HttpOnly cookies, X-LV-Request header          direct PUT/GET (presigned)
   v                                                                          |
Vercel function api/[...route].js  ----- service-role RPC ----> Supabase Postgres      v
   |  lib/app.js: route -> origin/CSRF -> authenticate(owner) -> handler       (RLS on, functions)   Backblaze B2 (private bucket)
   +---- Supabase Auth REST (password grant, refresh, recover)
   +---- B2 S3 API (presign, HEAD, multipart, delete) via AWS SDK v3
```
No privileged value reaches the browser: even the Supabase anon key stays server-side because login/refresh/reset are proxied by `/api/auth/*`.

## Request pipeline (`lib/app.js`)
1. Match route in `lib/routes.js` (404/405 otherwise). 2. Mutating routes need `Origin === APP_ORIGIN` and `X-LV-Request: 1`. 3. `owner` routes: `authenticate()` verifies the access token with Supabase (honours revocation), refreshes transparently, and requires `user.id === OWNER_USER_ID`, matching `OWNER_EMAIL`, confirmed. 4. Handler; DB error messages map to HTTP codes; unknown errors become a generic 500 and are logged without bodies/URLs/tokens. `cron` routes require `Bearer CRON_SECRET` (constant-time compare).

## Database (supabase/migrations)
`vault_profile` (single row via unique `((true))` index; `quota_bytes`, `used_bytes`, `reserved_bytes`, `CHECK used+reserved <= quota`), `nodes` (files+folders, `status` pending/active/trashed, `object_key` unique and server-generated, case-insensitive unique name among **active** siblings, trigger rejects non-folder parents and cycles), `upload_sessions`, `activity_log` (activity + security categories), `usage_snapshots`, `rate_limits`.
All writes go through SQL functions that take `p_owner` and filter by it. Execute is revoked from `public/anon/authenticated` and granted to `service_role`. RLS is enabled and forced everywhere; the only policies are owner `SELECT`.

## Upload flow
1. `POST /api/uploads/init {parentId,name,size}`: validate/sanitize; **content type derived from the extension** (client type ignored); `reserve_upload` locks the profile row, checks `used+reserved+size <= quota`, creates a *pending* node and an open session, and bumps `reserved_bytes` in one transaction. Server picks `objects/<uuid>` as the key.
2. ≤ 64 MiB: presigned PUT (15 min). Larger: B2 multipart created server-side, `upload_id` stored on the session; the browser requests part URLs (≤ 50 per call, validated against `part_count`) and uploads 32 MiB slices in parallel with retry.
3. `POST /api/uploads/complete`: multipart → `ListParts`, every part must exist with the exact expected size, then `CompleteMultipartUpload`. Always `HeadObject`: size must equal the reserved size or the upload is discarded (object deleted, reservation released). Then `commit_upload` (re-locks, checks session open/unexpired/size, activates the node, moves `reserved → used`, snapshots usage, logs). Retrying a committed session is idempotent.
4. Cancel/failure → `abort_upload` releases the reservation and the server aborts the multipart upload / deletes the object. Abandoned sessions (TTL 1 h single, 24 h multipart) are expired by `expire_sessions`: cron daily, and lazily when a reservation is refused.

## Download
`GET /api/downloads/url?id=` → `get_node` (owner filter) → must be an **active file** → presigned GET valid 120 s. Inline only for image/PDF/plain-text types with a server-chosen `Content-Type`; everything else is forced to `attachment` + `application/octet-stream`. Storage keys are never returned by any endpoint.

## Trash
`trash_node` marks the whole subtree trashed and flags the deleted item `trash_root` with `original_parent_id`. `restore_node` returns it to the original folder if still active (else the root), auto-renaming on conflict. Purge is two-phase: `purge_targets` → delete B2 objects (any failure aborts, nothing is removed) → `purge_commit` deletes rows and releases `used_bytes`. Separately trashed items under a purged folder are re-parented to the root.

## Failure recovery
Counters can be rebuilt with `recompute_usage` (Analytics page). Orphaned objects/stale multipart uploads: `npm run find-orphans`. Metadata backups: see DEPLOYMENT.md §8.
