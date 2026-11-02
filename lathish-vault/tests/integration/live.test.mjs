// REAL-service tests. Skipped unless RUN_INTEGRATION=1 and a fully configured .env points at a TEST Supabase project and TEST B2 bucket.
// They create then remove their own data, but never run them against a vault holding data you care about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDotEnv } from '../../scripts/env-file.mjs';
loadDotEnv();
const RUN = process.env.RUN_INTEGRATION === '1';
const opts = { skip: !RUN && 'set RUN_INTEGRATION=1 (and a configured .env) to run' };

async function deps() {
  const { loadConfig } = await import('../../lib/config.js'); const { createDb } = await import('../../lib/supabase/db.js'); const { createStorage } = await import('../../lib/storage/b2.js');
  const cfg = loadConfig(process.env); return { cfg, db: createDb(cfg), storage: createStorage(cfg) };
}
const reserve = (db, cfg, name, size) => db.rpc('reserve_upload', { p_owner: cfg.ownerId, p_parent: null, p_name: name, p_size: size, p_content_type: 'application/octet-stream',
  p_key: `objects/it-${crypto.randomUUID()}`, p_multipart: false, p_part_size: null, p_part_count: null, p_ttl_seconds: 600 });

test('DB: concurrent reservations near the quota cannot oversubscribe', opts, async () => {
  const { cfg, db } = await deps();
  const before = await db.rpc('storage_summary', { p_owner: cfg.ownerId });
  const size = Math.floor(before.availableBytes * 0.6);
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => reserve(db, cfg, `race-${i}.bin`, size)));
  const ok = results.filter((r) => r.status === 'fulfilled'); const bad = results.filter((r) => r.status === 'rejected');
  try { assert.equal(ok.length, 1, 'exactly one reservation fits'); assert.ok(bad.every((r) => r.reason.message === 'quota_exceeded')); }
  finally { for (const r of ok) await db.rpc('abort_upload', { p_owner: cfg.ownerId, p_session: r.value.sessionId }); }
  const after = await db.rpc('storage_summary', { p_owner: cfg.ownerId });
  assert.equal(after.reservedBytes, before.reservedBytes, 'reservation released');
});

test('B2: presigned PUT -> HEAD -> presigned GET -> delete (direct browser-style transfer)', opts, async () => {
  const { storage } = await deps(); const key = `objects/it-${crypto.randomUUID()}`; const body = Buffer.from('lathish vault integration test');
  const put = await fetch(await storage.presignPut({ key, contentType: 'text/plain' }), { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body });
  assert.ok(put.ok, `PUT failed: ${put.status}`);
  try {
    assert.equal((await storage.head(key)).size, body.length);
    const got = await fetch(await storage.presignGet({ key, contentType: 'application/octet-stream', disposition: 'attachment; filename="t.txt"' }));
    assert.equal(await got.text(), body.toString());
    const noSig = await fetch(`${process.env.B2_ENDPOINT}/${process.env.B2_BUCKET}/${key}`);
    assert.ok(!noSig.ok, 'bucket must be private');
  } finally { await storage.deleteObject(key); }
  assert.equal(await storage.head(key), null);
});
