import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { runChecks } from '../../scripts/check-code.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('code gate: syntax, no innerHTML/eval, no inline scripts/styles/handlers, no committed secrets', () => {
  assert.deepEqual(runChecks(), []);
});

test('vercel.json: CSP without unsafe-inline/eval, security headers, cron, long function timeout', () => {
  const v = JSON.parse(read('vercel.json'));
  const hs = Object.fromEntries(v.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value]));
  const csp = hs['Content-Security-Policy'];
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "script-src 'self'"]) assert.ok(csp.includes(d), d);
  for (const k of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) assert.ok(hs[k], k);
  assert.ok(!/\*\s*(;|$)/.test(csp.replace(/https:\/\/\*\./g, '')), 'no bare wildcard sources');
  assert.equal(v.crons[0].path, '/api/storage/cleanup');
});

test('migrations: RLS enabled + forced on every table; no policy allows writes; functions locked to service_role', () => {
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).sort(); assert.deepEqual(files, ['0001_schema.sql', '0002_functions.sql', '0003_rls.sql']);
  const schema = read('supabase/migrations/0001_schema.sql'); const rls = read('supabase/migrations/0003_rls.sql');
  const tables = [...schema.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length >= 6);
  for (const t of tables) { assert.match(rls, new RegExp(`alter table public\\.${t}\\s+enable row level security`), `${t} enable`); assert.match(rls, new RegExp(`alter table public\\.${t}\\s+force row level security`), `${t} force`); }
  assert.ok(!/for (insert|update|delete|all)/i.test(rls.replace(/--.*$/gm, '')), 'no write policies');
  assert.match(rls, /revoke all on all functions in schema public from public, anon, authenticated/);
  assert.match(rls, /grant execute on all functions in schema public to service_role/);
  assert.match(schema, /1000000000/);
});

test('quota functions lock the profile row and never trust client sizes', () => {
  const f = read('supabase/migrations/0002_functions.sql');
  const reserve = f.slice(f.indexOf('create function public.reserve_upload'), f.indexOf('create function public.set_upload_id'));
  assert.match(reserve, /for update/); assert.match(reserve, /quota_exceeded/);
  const commit = f.slice(f.indexOf('create function public.commit_upload'), f.indexOf('create function public.abort_upload'));
  assert.match(commit, /size_mismatch/); assert.match(commit, /for update/);
  assert.match(f, /where owner_id = p_owner/, 'owner filters present');
});

test('API handlers never return storage keys or presigned secrets in logs', () => {
  const files = ['lib/handlers/uploads.js', 'lib/handlers/downloads.js', 'lib/handlers/files.js'].map(read).join('\n');
  assert.ok(!/log\([^)]*url/i.test(files));
  assert.match(read('lib/handlers/files.js'), /delete node\.objectKey/);
});

test('frontend sends no privileged config and no tokens are stored in the browser', () => {
  const js = readdirSync(new URL('../../public/assets/js/', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => read(`public/assets/js/${f}`)).join('\n');
  assert.ok(!/localStorage\.setItem\([^)]*(token|session|jwt)/i.test(js));
  assert.ok(!/sessionStorage/.test(js));
});

test('only public/ is served statically; server code and migrations are outside it', () => {
  const v = JSON.parse(read('vercel.json')); assert.equal(v.outputDirectory, 'public');
  const pub = readdirSync(new URL('../../public/', import.meta.url));
  for (const f of ['index.html', 'login.html', 'dashboard.html', '404.html', 'error.html', 'assets']) assert.ok(pub.includes(f), f);
  for (const bad of ['lib', 'supabase', 'tests', 'scripts', 'api', '.env']) assert.ok(!pub.includes(bad), bad);
});
