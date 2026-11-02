import { ApiError } from '../http.js';
import { audit } from '../security/session.js';
import { cleanupExpired } from './uploads.js';

export async function summary({ deps, user }) {
  return { body: await deps.db.rpc('storage_summary', { p_owner: user.id }) };
}
export async function events({ query, deps, user }) {
  const category = query.category === 'security' ? 'security' : 'activity';
  return { body: { events: await deps.db.rpc('list_events', { p_owner: user.id, p_category: category, p_limit: 50 }) } };
}
export async function setProfile({ body, deps, user }) {
  const name = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!name || name.length > 60) throw new ApiError(400, 'invalid_request', 'Display name must be 1-60 characters');
  await deps.db.rpc('set_display_name', { p_owner: user.id, p_name: name });
  return { body: { ok: true } };
}
export async function recompute({ deps, user }) {
  const r = await deps.db.rpc('recompute_usage', { p_owner: user.id });
  await audit(deps, 'security', 'storage.recomputed', null, r);
  return { body: r };
}
/** Vercel Cron (GET + Bearer CRON_SECRET). Releases expired reservations and aborts their B2 multipart uploads. */
export async function cleanup({ deps }) {
  return { body: { expired: await cleanupExpired(deps) } };
}
