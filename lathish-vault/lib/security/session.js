import { ApiError } from '../http.js';
import { cookieNames, parseCookies, sessionCookies } from './cookies.js';

/**
 * Server-side authentication for every protected endpoint.
 * Verifies the access token with Supabase (so revocation is honoured), transparently refreshes an
 * expired one, and finally requires the user to be the configured owner. Anything else => 401.
 */
export async function authenticate(ctx) {
  const { cfg, auth } = ctx.deps;
  const names = cookieNames(cfg);
  const jar = parseCookies(ctx.req.headers.cookie || '');
  let user = null;
  if (jar[names.access]) user = await auth.getUser(jar[names.access]);
  if (!user && jar[names.refresh]) {
    const s = await auth.refresh(jar[names.refresh]);
    if (s) { ctx.cookies.push(...sessionCookies(cfg, s)); user = s.user; }
  }
  if (!user) throw new ApiError(401, 'unauthorized', 'Please sign in');
  if (!isOwner(cfg, user)) throw new ApiError(401, 'unauthorized', 'Please sign in');
  return { id: user.id, email: user.email };
}

export function isOwner(cfg, user) {
  return String(user?.id || '').toLowerCase() === cfg.ownerId
    && String(user?.email || '').toLowerCase() === cfg.ownerEmail
    && Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

export async function audit(deps, category, action, nodeId = null, detail = {}) {
  try { await deps.db.rpc('log_event', { p_owner: deps.cfg.ownerId, p_category: category, p_action: action, p_node: nodeId, p_detail: detail }); }
  catch (e) { deps.log('warn', 'audit_failed', { action, message: e.message }); }
}

/** Atomic DB-backed rate limit. Fail closed for auth endpoints (throws 429 or 503 if the limiter is unreachable). */
export async function rateLimit(deps, key, windowSeconds, max) {
  let ok;
  try { ok = await deps.db.rpc('rate_limit_hit', { p_key: key, p_window_seconds: windowSeconds, p_max: max }); }
  catch { throw new ApiError(503, 'unavailable', 'Service temporarily unavailable'); }
  if (!ok) throw new ApiError(429, 'rate_limited', 'Too many attempts. Please wait and try again.');
}
