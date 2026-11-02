import { loadConfig } from '../../lib/config.js';
import { createApp } from '../../lib/app.js';
import { DbError } from '../../lib/supabase/db.js';

export const OWNER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const ORIGIN = 'http://localhost:3000';
export const ENV = {
  SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon-test', SUPABASE_SERVICE_ROLE_KEY: 'service-test',
  OWNER_USER_ID: OWNER, OWNER_EMAIL: 'owner@example.com',
  B2_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com', B2_BUCKET: 'bkt', B2_KEY_ID: 'kid', B2_APPLICATION_KEY: 'bkey',
  APP_ORIGIN: ORIGIN, CRON_SECRET: 'x'.repeat(40),
};
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const makeCfg = (over = {}) => loadConfig({ ...ENV, ...over });

/** In-memory MIRROR of the SQL functions' contract, used to test the API orchestration.
 *  It does NOT execute the SQL migrations (no Postgres in this environment). */
export class FakeDb {
  constructor(quota = 1_000_000_000) {
    this.p = { used: 0, reserved: 0, quota }; this.sessions = new Map(); this.nodes = new Map(); this.events = []; this.rl = new Map(); this.n = 0;
  }
  async rpc(name, a = {}) {
    const f = this[`r_${name}`]; if (!f) throw new Error(`unmocked rpc ${name}`);
    await Promise.resolve(); return f.call(this, a);
  }
  fail(m) { throw new DbError(m, 'P0001', 400); }
  r_log_event(a) { this.events.push(a); }
  r_rate_limit_hit({ p_key, p_max }) { const c = (this.rl.get(p_key) || 0) + 1; this.rl.set(p_key, c); return c <= p_max; }
  r_storage_summary() { return { displayName: 'Owner', quotaBytes: this.p.quota, usedBytes: this.p.used, reservedBytes: this.p.reserved }; }
  r_reserve_upload(a) {
    if (a.p_owner !== OWNER) this.fail('not_found');
    if (this.p.used + this.p.reserved + a.p_size > this.p.quota) this.fail('quota_exceeded');
    const id = uid(0x1000 + ++this.n); const nodeId = uid(0x2000 + this.n);
    this.nodes.set(nodeId, { id: nodeId, name: a.p_name, size: a.p_size, status: 'pending', kind: 'file', mimeType: a.p_content_type });
    this.sessions.set(id, { id, owner: a.p_owner, nodeId, objectKey: a.p_key, size: a.p_size, contentType: a.p_content_type,
      multipart: a.p_multipart, partSize: a.p_part_size, partCount: a.p_part_count, status: 'open', uploadId: null, expiresAt: Date.now() + a.p_ttl_seconds * 1000 });
    this.p.reserved += a.p_size;
    return { sessionId: id, nodeId, name: a.p_name, objectKey: a.p_key, expiresAt: new Date(Date.now() + 1000).toISOString() };
  }
  sess(a) { const s = this.sessions.get(a.p_session); if (!s || s.owner !== a.p_owner) this.fail('not_found'); return s; }
  r_set_upload_id(a) { this.sess(a).uploadId = a.p_upload_id; }
  r_get_upload_session(a) { const s = this.sess(a); return { ...s, expired: s.expiresAt <= Date.now() }; }
  r_commit_upload(a) {
    const s = this.sess(a);
    if (s.status !== 'open' || s.expiresAt <= Date.now()) this.fail('session_invalid');
    if (a.p_actual_size !== s.size) this.fail('size_mismatch');
    s.status = 'committed'; this.p.reserved -= s.size; this.p.used += s.size;
    const n = this.nodes.get(s.nodeId); n.status = 'active'; return { ...n };
  }
  r_abort_upload(a) {
    const s = this.sess(a);
    if (s.status !== 'open') return { released: false, objectKey: s.objectKey, uploadId: s.uploadId, multipart: s.multipart, status: s.status };
    s.status = a.p_status; this.p.reserved -= s.size; this.nodes.delete(s.nodeId);
    return { released: true, objectKey: s.objectKey, uploadId: s.uploadId, multipart: s.multipart };
  }
  r_expire_sessions() {
    const out = [];
    for (const s of this.sessions.values()) if (s.status === 'open' && s.expiresAt <= Date.now())
      out.push(this.r_abort_upload({ p_owner: s.owner, p_session: s.id, p_status: 'expired' }));
    return out;
  }
  r_get_node(a) { const n = this.nodes.get(a.p_id); if (!n || n.status === 'pending') this.fail('not_found'); return { ...n, objectKey: 'k' }; }
}

export class FakeStorage {
  constructor() { this.objects = new Map(); this.multipart = new Map(); this.deleted = []; this.failCreate = false; }
  async presignPut({ key }) { return `https://bkt.s3.us-west-004.backblazeb2.com/${key}?X-Amz-Signature=sig`; }
  async presignGet({ key, contentType, disposition }) { this.lastGet = { key, contentType, disposition }; return `https://bkt.s3.us-west-004.backblazeb2.com/${key}?sig`; }
  async presignPart({ key, uploadId, partNumber }) { return `https://bkt.s3/${key}?uploadId=${uploadId}&partNumber=${partNumber}`; }
  async head(key) { return this.objects.has(key) ? { size: this.objects.get(key) } : null; }
  async createMultipart() { if (this.failCreate) throw new Error('b2 down'); const id = `up${this.multipart.size + 1}`; this.multipart.set(id, { parts: [] }); return id; }
  async listParts({ uploadId }) { return this.multipart.has(uploadId) ? this.multipart.get(uploadId).parts : null; }
  async completeMultipart({ key, uploadId, parts }) { this.objects.set(key, parts.reduce((s, p) => s + p.size, 0)); this.multipart.delete(uploadId); }
  async abortMultipart({ uploadId }) { this.multipart.delete(uploadId); }
  async deleteObject(key) { this.deleted.push(key); this.objects.delete(key); }
  put(key, size) { this.objects.set(key, size); } // simulates the browser PUT to B2
}

export class FakeAuth {
  constructor() { this.signedOut = []; this.pw = 'correct-horse-battery'; this.recovered = []; this.tokens = new Map([['at-valid', 'owner'], ['rt-valid', 'owner']]); }
  user(who) { return who === 'owner' ? { id: OWNER, email: 'owner@example.com', email_confirmed_at: '2025-01-01' } : { id: OTHER, email: 'other@example.com', email_confirmed_at: '2025-01-01' }; }
  async passwordLogin(email, pw) {
    if (email === 'owner@example.com' && pw === this.pw) return { accessToken: 'at-valid', refreshToken: 'rt-valid', expiresIn: 3600, user: this.user('owner') };
    if (email === 'other@example.com' && pw === 'otherpassword12') return { accessToken: 'at-other', refreshToken: 'rt-other', expiresIn: 3600, user: this.user('other') };
    return null;
  }
  async getUser(t) { return t === 'at-valid' ? this.user('owner') : t === 'at-other' ? this.user('other') : null; }
  async refresh(t) { return t === 'rt-valid' ? { accessToken: 'at-valid', refreshToken: 'rt-new', expiresIn: 3600, user: this.user('owner') } : null; }
  async signOut(t, scope) { this.signedOut.push([t, scope]); }
  async recover(email) { this.recovered.push(email); }
  async updatePassword() { return true; }
}

export function makeApp(over = {}) {
  const deps = { cfg: makeCfg(over.env), db: new FakeDb(over.quota), storage: new FakeStorage(), auth: new FakeAuth(),
    log: () => {}, randomUUID: (() => { let i = 0; return () => `00000000-0000-4000-8000-${String(++i).padStart(12, '0')}`; })() };
  return { deps, app: createApp(deps) };
}

export async function call(app, { method = 'GET', url, body, headers = {}, auth = true } = {}) {
  const req = { method, url, body, headers: { origin: ORIGIN, 'x-lv-request': '1', ...(auth ? { cookie: 'lv_at=at-valid' } : {}), ...headers } };
  const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } };
  await app(req, res);
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, headers: res.headers, raw: res.body };
}
