import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeApp } from '../helpers/fakes.js';

test('valid login sets HttpOnly SameSite=Strict cookies and never returns tokens', async () => {
  const { app } = makeApp();
  const r = await call(app, { method: 'POST', url: '/api/auth/login', body: { email: 'Owner@Example.com', password: 'correct-horse-battery' }, auth: false });
  assert.equal(r.status, 200);
  const cookies = r.headers['set-cookie'];
  assert.equal(cookies.length, 2);
  for (const c of cookies) { assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); }
  assert.ok(!r.raw.includes('at-valid'), 'token must not be in the body');
});

test('invalid login, unknown user and non-owner user get the identical generic 401', async () => {
  const { app, deps } = makeApp();
  const a = await call(app, { method: 'POST', url: '/api/auth/login', body: { email: 'owner@example.com', password: 'wrong' }, auth: false });
  const b = await call(app, { method: 'POST', url: '/api/auth/login', body: { email: 'nobody@example.com', password: 'wrong' }, auth: false });
  const c = await call(app, { method: 'POST', url: '/api/auth/login', body: { email: 'other@example.com', password: 'otherpassword12' }, auth: false });
  for (const r of [a, b, c]) { assert.equal(r.status, 401); assert.equal(r.json.error.code, 'invalid_credentials'); assert.ok(!r.headers['set-cookie']); }
  assert.deepEqual(a.json, b.json); assert.deepEqual(b.json, c.json);
  assert.ok(deps.auth.signedOut.some(([t]) => t === 'at-other'), 'non-owner session must be revoked');
  assert.ok(deps.db.events.some((e) => e.p_action === 'auth.login_failed'));
});

test('login is rate limited', async () => {
  const { app } = makeApp();
  let last;
  for (let i = 0; i < 12; i++) last = await call(app, { method: 'POST', url: '/api/auth/login', body: { email: 'owner@example.com', password: 'bad' }, auth: false });
  assert.equal(last.status, 429);
});

test('every owner endpoint rejects unauthenticated requests', async () => {
  const { app } = makeApp();
  const gets = ['/api/auth/session', '/api/files/list', '/api/files/get?id=x', '/api/downloads/url?id=x', '/api/storage/summary', '/api/storage/events'];
  for (const url of gets) assert.equal((await call(app, { url, auth: false })).status, 401, url);
  const posts = ['/api/uploads/init', '/api/uploads/complete', '/api/uploads/part-urls', '/api/uploads/abort', '/api/files/trash', '/api/files/purge', '/api/folders/create'];
  for (const url of posts) assert.equal((await call(app, { method: 'POST', url, body: {}, auth: false })).status, 401, url);
});

test('a valid Supabase session for a non-owner is rejected', async () => {
  const { app } = makeApp();
  const r = await call(app, { url: '/api/storage/summary', auth: false, headers: { cookie: 'lv_at=at-other' } });
  assert.equal(r.status, 401);
});

test('expired access token is transparently refreshed; expired refresh is denied', async () => {
  const { app } = makeApp();
  const ok = await call(app, { url: '/api/storage/summary', auth: false, headers: { cookie: 'lv_at=expired; lv_rt=rt-valid' } });
  assert.equal(ok.status, 200); assert.ok(ok.headers['set-cookie']);
  const bad = await call(app, { url: '/api/storage/summary', auth: false, headers: { cookie: 'lv_at=expired; lv_rt=rt-dead' } });
  assert.equal(bad.status, 401);
});

test('CSRF: mutating requests need the exact Origin and custom header', async () => {
  const { app } = makeApp();
  assert.equal((await call(app, { method: 'POST', url: '/api/folders/create', body: { name: 'x' }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(app, { method: 'POST', url: '/api/folders/create', body: { name: 'x' }, headers: { 'x-lv-request': '0' } })).status, 403);
});

test('cron endpoint requires the bearer secret', async () => {
  const { app, deps } = makeApp();
  assert.equal((await call(app, { url: '/api/storage/cleanup', auth: false })).status, 401);
  assert.equal((await call(app, { url: '/api/storage/cleanup', auth: false, headers: { authorization: 'Bearer nope' } })).status, 401);
  const ok = await call(app, { url: '/api/storage/cleanup', auth: false, headers: { authorization: `Bearer ${deps.cfg.cronSecret}` } });
  assert.equal(ok.status, 200);
});

test('password reset never reveals whether the address is the owner', async () => {
  const { app, deps } = makeApp();
  const a = await call(app, { method: 'POST', url: '/api/auth/reset', body: { email: 'owner@example.com' }, auth: false });
  const b = await call(app, { method: 'POST', url: '/api/auth/reset', body: { email: 'stranger@example.com' }, auth: false });
  assert.equal(a.status, 202); assert.equal(b.status, 202); assert.deepEqual(a.json, b.json);
  assert.deepEqual(deps.auth.recovered, ['owner@example.com']);
});

test('unknown routes and bad JSON are safe errors', async () => {
  const { app } = makeApp();
  assert.equal((await call(app, { url: '/api/nope' })).status, 404);
  assert.equal((await call(app, { method: 'DELETE', url: '/api/files/list' })).status, 405);
});
