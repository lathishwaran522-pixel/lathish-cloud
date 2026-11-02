import { timingSafeEqual, randomUUID } from 'node:crypto';
import { ApiError, readJson, sendJson } from './http.js';
import { mapDbError } from './supabase/db.js';
import { authenticate } from './security/session.js';
import { routes } from './routes.js';
import { log } from './security/log.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Builds the request handler. `deps` = { cfg, db, auth, storage, log?, randomUUID? } (injected for tests). */
export function createApp(deps) {
  const d = { log, randomUUID, ...deps };
  return async function handle(req, res) {
    const cookies = [];
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const matches = routes.filter((r) => r[1] === path);
      if (!matches.length) throw new ApiError(404, 'not_found', 'Not found');
      const route = matches.find((r) => r[0] === req.method);
      if (!route) throw new ApiError(405, 'method_not_allowed', 'Method not allowed');
      const [, , handler, mode] = route;

      if (mode === 'cron') {
        const h = String(req.headers.authorization || '');
        if (!h.startsWith('Bearer ') || !safeEqual(h.slice(7), d.cfg.cronSecret)) throw new ApiError(401, 'unauthorized', 'Unauthorized');
      } else if (MUTATING.has(req.method)) {
        // CSRF defence in depth (cookies are also SameSite=Strict): exact Origin + a custom header a cross-site form cannot send.
        if (req.headers.origin !== d.cfg.appOrigin || req.headers['x-lv-request'] !== '1') throw new ApiError(403, 'forbidden_origin', 'Forbidden');
      }

      const ctx = { req, res, deps: d, cookies, query: Object.fromEntries(url.searchParams), body: {}, user: null };
      if (mode === 'owner') ctx.user = await authenticate(ctx);
      if (MUTATING.has(req.method)) {
        const b = await readJson(req);
        if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'invalid_json', 'Body must be a JSON object');
        ctx.body = b;
      }
      let out;
      try { out = await handler(ctx); } catch (e) { throw mapDbError(e); }
      return sendJson(res, out.status || 200, out.body ?? { ok: true }, cookies);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'server_misconfigured') d.log('error', 'misconfigured', { problems: e.extra?.problems });
        return sendJson(res, e.status, { error: { code: e.code, message: e.status === 500 ? 'Server error' : e.message, ...(e.status === 409 && e.extra ? e.extra : {}) } }, cookies);
      }
      d.log('error', 'unhandled', { message: e?.message, name: e?.name }); // never log bodies, tokens or URLs
      return sendJson(res, 500, { error: { code: 'server_error', message: 'Something went wrong' } }, cookies);
    }
  };
}
