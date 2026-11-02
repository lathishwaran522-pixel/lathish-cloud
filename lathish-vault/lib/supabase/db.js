import { ApiError } from '../http.js';

export class DbError extends Error {
  constructor(message, code, status) { super(message); this.code = code; this.status = status; }
}

/** Service-role PostgREST client. Only calls SQL functions (RPC) with named parameters: no string-built queries. */
export function createDb(cfg, fetchImpl = fetch) {
  return {
    async rpc(name, args = {}) {
      if (!/^[a-z_]+$/.test(name)) throw new Error('invalid rpc name');
      let r;
      try {
        r = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(15000),
        });
      } catch { throw new ApiError(502, 'db_unavailable', 'Database unavailable'); }
      const text = await r.text();
      let json = null; if (text) { try { json = JSON.parse(text); } catch { /* non-JSON */ } }
      if (!r.ok) throw new DbError(json?.message || `db_error_${r.status}`, json?.code, r.status);
      return json;
    },
  };
}

const MAP = {
  not_found: [404, 'Not found'],
  quota_exceeded: [413, 'Storage limit reached: the 1 GB vault is full'],
  name_conflict: [409, 'An item with that name already exists here'],
  invalid_parent: [409, 'That destination is not valid'],
  session_invalid: [409, 'Upload session is no longer valid'],
  size_mismatch: [422, 'Uploaded file size did not match'],
  invalid_size: [400, 'Invalid file size'],
};
export function mapDbError(e) {
  if (e instanceof ApiError) return e;
  if (e instanceof DbError) {
    if (MAP[e.message]) return new ApiError(MAP[e.message][0], e.message, MAP[e.message][1]);
    if (e.code === '23505') return new ApiError(409, 'name_conflict', MAP.name_conflict[1]);
    if (e.code === '23514') return new ApiError(400, 'invalid_request', 'Request violates a constraint');
  }
  return e;
}
