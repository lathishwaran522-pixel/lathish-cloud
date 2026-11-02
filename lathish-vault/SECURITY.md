# Security

**No system is perfectly secure.** This document states what is implemented, what is assumed, and what you must do.

## Threat model
Protects against: strangers reaching files or the API; credential guessing; CSRF; XSS via uploaded content; quota exhaustion races; leaked/guessed storage URLs; a compromised non-owner Supabase user. Does **not** protect against: a compromised Supabase, Vercel or Backblaze account, a compromised owner device or password, malicious dependencies, or the providers themselves reading data (files are not end-to-end encrypted).

## Authentication
Single owner created out-of-band (`npm run create-owner`); no registration endpoint; disable sign-ups in Supabase as well. Login is a server-side password grant; tokens live only in `HttpOnly; SameSite=Strict` cookies (`Secure` + `__Host-` prefix in production). Wrong password, unknown user and valid-but-not-owner users all return the same generic 401 (non-owner sessions are revoked). Rate limits (Postgres-backed, atomic): 20/15 min per IP and 10/15 min global for login; reset requests 5/h per IP. Reset mails are requested only for `OWNER_EMAIL`, always answered `202`, and completing a reset requires a recovery token belonging to the owner. Password policy: 12–128 chars. **Recommended hardening not implemented:** Supabase MFA (TOTP); enable 2FA on all three provider accounts.

## Authorization
Every `owner` endpoint calls `authenticate()` (token verified remotely, owner id + email + confirmation checked). The service-role key bypasses RLS, so every SQL function also filters by `p_owner`. Node ids, session ids, names and sizes from the browser are validated (UUID, sanitised names, integer sizes) and never used as storage paths.

## Storage
Private bucket; presigned URLs expire in 2 min (download), 15 min (single PUT), 60 min (parts). Object keys are `objects/<uuid>`. Uploaded content is never served as HTML: types come from the extension, scripting-capable text is stored as `text/plain`, downloads are forced to `attachment`. Size is verified by `HeadObject` (and `ListParts`) before commit; the presigned PUT signs `Content-Type` only, so an owner holding a URL could briefly upload more than reserved. It is detected and deleted at completion/cleanup (optionally test signing `Content-Length` too in staging).

## Browser hardening
CSP `default-src 'self'`, `script-src 'self'`, `style-src 'self'` (no inline anything; enforced by `npm run lint`), `frame-ancestors 'none'`, HSTS, nosniff, `Referrer-Policy: no-referrer`, COOP/CORP, locked Permissions-Policy. The UI builds DOM with text nodes only (`innerHTML` is banned by the linter). File text is shown with `textContent`.

## Secrets
Only in Vercel env vars / local `.env` (git-ignored). The browser receives none. Logs redact fields matching pass/token/secret/key/url/cookie; request bodies and signed URLs are never logged. Startup validation reports missing variable *names* only.

## Credential rotation
- **B2 key:** create a new bucket-scoped key, update `B2_KEY_ID`/`B2_APPLICATION_KEY` in Vercel, redeploy, then delete the old key. Existing presigned URLs die with the old key (≤ 60 min).
- **Supabase service-role/anon keys:** rotate in Supabase → update Vercel → redeploy. **Owner password:** Account → Change password (signs out other sessions). **CRON_SECRET:** change in Vercel and redeploy.
- After a suspected leak: rotate everything above, "Sign out other sessions", review the Security log, run `find-orphans`.

## Incident response
1. Rotate credentials (above). 2. Review Supabase auth logs and the in-app security log (logins, failed logins, downloads). 3. Check B2 access logs and the bucket's private setting. 4. Restore metadata from backup if needed (DEPLOYMENT.md §8). 5. Run `npm audit` and redeploy.

## Shared responsibility
Supabase: database/auth availability, backups (plan dependent), auth settings (sign-ups off, JWT expiry, session time-box). Vercel: hosting, TLS, env-var storage, access control to the project. Backblaze: durability, bucket privacy setting, CORS rules, key scoping. You: strong unique owner password + 2FA everywhere, keeping dependencies patched, and testing restores.
