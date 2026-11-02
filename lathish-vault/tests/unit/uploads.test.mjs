import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeApp } from '../helpers/fakes.js';
import { MULTIPART_THRESHOLD, PART_SIZE } from '../../lib/constants.js';

const init = (app, over = {}) => call(app, { method: 'POST', url: '/api/uploads/init', body: { name: 'a.txt', size: 1000, parentId: null, ...over } });
const complete = (app, sessionId) => call(app, { method: 'POST', url: '/api/uploads/complete', body: { sessionId } });

test('small upload: reserve -> direct PUT -> verify -> commit', async () => {
  const { app, deps } = makeApp();
  const r = await init(app);
  assert.equal(r.status, 201);
  assert.equal(r.json.multipart, false);
  assert.match(r.json.url, /^https:\/\/.*backblazeb2\.com\/objects\//);
  assert.ok(!('objectKey' in r.json), 'storage key must not be exposed');
  assert.equal(deps.db.p.reserved, 1000);
  deps.storage.put([...deps.db.sessions.values()][0].objectKey, 1000);
  const c = await complete(app, r.json.sessionId);
  assert.equal(c.status, 200);
  assert.deepEqual([deps.db.p.used, deps.db.p.reserved], [1000, 0]);
});

test('complete before the browser uploaded is refused and the session stays open', async () => {
  const { app, deps } = makeApp();
  const r = await init(app);
  const c = await complete(app, r.json.sessionId);
  assert.equal(c.status, 409); assert.equal(c.json.error.code, 'object_missing');
  assert.equal(deps.db.p.reserved, 1000);
});

test('uploaded object with the wrong size is discarded and its reservation released', async () => {
  const { app, deps } = makeApp();
  const r = await init(app);
  const key = [...deps.db.sessions.values()][0].objectKey;
  deps.storage.put(key, 5000);
  const c = await complete(app, r.json.sessionId);
  assert.equal(c.status, 422);
  assert.deepEqual([deps.db.p.used, deps.db.p.reserved], [0, 0]);
  assert.ok(deps.storage.deleted.includes(key));
});

test('quota: over-limit upload is rejected with a clear message and nothing is deleted', async () => {
  const { app, deps } = makeApp({ quota: 10_000 });
  const r = await init(app, { size: 10_001 });
  assert.equal(r.status, 413); assert.match(r.json.error.message, /limit/i);
  assert.equal((await call(app, { method: 'POST', url: '/api/uploads/init', body: { name: 'big.bin', size: 1_000_000_001 } })).status, 413);
  assert.equal(deps.db.p.reserved, 0);
});

test('two simultaneous uploads near the quota: exactly one wins (orchestration level)', async () => {
  const { app, deps } = makeApp({ quota: 10_000 });
  const [a, b] = await Promise.all([init(app, { size: 6000, name: 'a.bin' }), init(app, { size: 6000, name: 'b.bin' })]);
  assert.deepEqual([a.status, b.status].sort(), [201, 413]);
  assert.equal(deps.db.p.reserved, 6000);
});

test('abort and failure paths release reservations', async () => {
  const { app, deps } = makeApp();
  const r = await init(app);
  const ab = await call(app, { method: 'POST', url: '/api/uploads/abort', body: { sessionId: r.json.sessionId } });
  assert.equal(ab.json.released, true); assert.equal(deps.db.p.reserved, 0);
  const again = await call(app, { method: 'POST', url: '/api/uploads/abort', body: { sessionId: r.json.sessionId } });
  assert.equal(again.json.released, false);

  deps.storage.failCreate = true; // B2 refuses to start a multipart upload
  const f = await init(app, { size: MULTIPART_THRESHOLD + 1, name: 'big.bin' });
  assert.equal(f.status, 502); assert.equal(deps.db.p.reserved, 0);
});

test('expired session cannot be completed; reservation is released', async () => {
  const { app, deps } = makeApp();
  const r = await init(app);
  const s = [...deps.db.sessions.values()][0]; s.expiresAt = Date.now() - 1;
  deps.storage.put(s.objectKey, 1000);
  const c = await complete(app, r.json.sessionId);
  assert.equal(c.status, 410);
  assert.equal(deps.db.p.reserved, 0); assert.equal(deps.db.p.used, 0);
});

test('cleanup expires abandoned sessions and aborts their multipart uploads', async () => {
  const { app, deps } = makeApp();
  await init(app, { size: MULTIPART_THRESHOLD + 10, name: 'big.bin' });
  assert.equal(deps.storage.multipart.size, 1);
  [...deps.db.sessions.values()][0].expiresAt = Date.now() - 1;
  const r = await call(app, { url: '/api/storage/cleanup', auth: false, headers: { authorization: `Bearer ${deps.cfg.cronSecret}` } });
  assert.equal(r.json.expired, 1);
  assert.equal(deps.storage.multipart.size, 0); assert.equal(deps.db.p.reserved, 0);
});

test('multipart: part URLs validated; incomplete parts refused; complete commits', async () => {
  const { app, deps } = makeApp();
  const size = PART_SIZE * 2 + 5;
  const r = await init(app, { size, name: 'movie.mp4' });
  assert.equal(r.json.multipart, true); assert.equal(r.json.partCount, 3);
  const pu = (parts) => call(app, { method: 'POST', url: '/api/uploads/part-urls', body: { sessionId: r.json.sessionId, parts } });
  assert.equal((await pu([0])).status, 400);
  assert.equal((await pu([4])).status, 400);
  const ok = await pu([1, 3]);
  assert.equal(ok.status, 200); assert.equal(ok.json.parts[1].size, 5);

  const up = deps.storage.multipart.get('up1');
  up.parts = [{ partNumber: 1, size: PART_SIZE, etag: 'a' }, { partNumber: 2, size: 10, etag: 'b' }]; // wrong size + missing 3
  const bad = await complete(app, r.json.sessionId);
  assert.equal(bad.status, 409); assert.deepEqual(bad.json.error.missing, [2, 3]);

  up.parts = [{ partNumber: 1, size: PART_SIZE, etag: 'a' }, { partNumber: 2, size: PART_SIZE, etag: 'b' }, { partNumber: 3, size: 5, etag: 'c' }];
  const good = await complete(app, r.json.sessionId);
  assert.equal(good.status, 200); assert.equal(deps.db.p.used, size);
  const retry = await complete(app, r.json.sessionId); // idempotent
  assert.equal(retry.status, 200); assert.equal(deps.db.p.used, size);
});

test('part URLs and completion are refused for a closed session, and sessions of unknown ids are 404', async () => {
  const { app } = makeApp();
  const r = await init(app, { size: MULTIPART_THRESHOLD + 1, name: 'x.bin' });
  await call(app, { method: 'POST', url: '/api/uploads/abort', body: { sessionId: r.json.sessionId } });
  assert.equal((await call(app, { method: 'POST', url: '/api/uploads/part-urls', body: { sessionId: r.json.sessionId, parts: [1] } })).status, 409);
  assert.equal((await complete(app, r.json.sessionId)).status, 409);
  assert.equal((await complete(app, '99999999-9999-4999-8999-999999999999')).status, 404);
  assert.equal((await complete(app, 'not-a-uuid')).status, 400);
});

test('blocked extension and hostile names are handled', async () => {
  const { app } = makeApp();
  assert.equal((await init(app, { name: 'evil.scr' })).status, 400);
  const r = await init(app, { name: '../../etc/passwd' });
  assert.equal(r.status, 201); assert.equal(r.json.name, '.._.._etc_passwd');
  assert.equal((await init(app, { size: -1 })).status, 400);
  assert.equal((await init(app, { size: 1.5 })).status, 400);
});

test('download: only active files, inline only for safe types, attachment otherwise', async () => {
  const { app, deps } = makeApp();
  deps.db.nodes.set('00000000-0000-4000-8000-0000000000aa', { id: '00000000-0000-4000-8000-0000000000aa', kind: 'file', status: 'active', name: 'x.html', mimeType: 'text/plain', size: 3 });
  deps.db.nodes.set('00000000-0000-4000-8000-0000000000bb', { id: '00000000-0000-4000-8000-0000000000bb', kind: 'file', status: 'trashed', name: 'gone.pdf', mimeType: 'application/pdf', size: 3 });
  deps.db.nodes.set('00000000-0000-4000-8000-0000000000cc', { id: '00000000-0000-4000-8000-0000000000cc', kind: 'file', status: 'active', name: 'p.zip', mimeType: 'application/zip', size: 3 });
  const t = await call(app, { url: '/api/downloads/url?id=00000000-0000-4000-8000-0000000000aa&disposition=inline' });
  assert.equal(t.status, 200); assert.equal(deps.storage.lastGet.contentType, 'text/plain'); assert.match(deps.storage.lastGet.disposition, /^inline/);
  assert.equal((await call(app, { url: '/api/downloads/url?id=00000000-0000-4000-8000-0000000000bb' })).status, 404);
  const z = await call(app, { url: '/api/downloads/url?id=00000000-0000-4000-8000-0000000000cc&disposition=inline' });
  assert.equal(deps.storage.lastGet.contentType, 'application/octet-stream'); assert.match(deps.storage.lastGet.disposition, /^attachment/);
  assert.equal(z.json.previewKind, null);
});
