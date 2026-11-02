import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENV_NAMES, loadConfig } from '../../lib/config.js';
import { ENV } from '../helpers/fakes.js';

test('valid environment loads', () => { const c = loadConfig(ENV); assert.equal(c.b2Region, 'us-west-004'); assert.equal(c.secureCookies, false); });
test('missing variables are reported by name only, never by value', () => {
  try { loadConfig({ ...ENV, B2_APPLICATION_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' }); assert.fail('should throw'); }
  catch (e) {
    const t = JSON.stringify(e.extra);
    assert.ok(t.includes('B2_APPLICATION_KEY') && t.includes('SUPABASE_SERVICE_ROLE_KEY'));
    assert.ok(!t.includes(ENV.B2_KEY_ID));
  }
});
test('rejects http origins (non-local), trailing slash, bad uuid, short cron secret', () => {
  assert.throws(() => loadConfig({ ...ENV, APP_ORIGIN: 'http://vault.example.com' }));
  assert.throws(() => loadConfig({ ...ENV, APP_ORIGIN: 'https://vault.example.com/' }));
  assert.throws(() => loadConfig({ ...ENV, OWNER_USER_ID: 'nope' }));
  assert.throws(() => loadConfig({ ...ENV, CRON_SECRET: 'short' }));
  assert.equal(loadConfig({ ...ENV, APP_ORIGIN: 'https://vault.example.com' }).secureCookies, true);
});
test('.env.example documents every variable and holds only placeholders', () => {
  const t = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
  for (const n of ENV_NAMES) assert.match(t, new RegExp(`^${n}=`, 'm'), n);
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(t), 'no JWT-looking secrets');
  assert.ok(!/(NEXT_PUBLIC|VITE_|PUBLIC_)/.test(t.replace(/#.*$/gm, '')), 'no public prefixes on variables');
});
