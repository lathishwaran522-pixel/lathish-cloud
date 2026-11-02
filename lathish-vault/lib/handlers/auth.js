import { ApiError, clientIp, shortHash } from '../http.js';
import { clearCookies, cookieNames, parseCookies, sessionCookies } from '../security/cookies.js';
import { audit, isOwner, rateLimit } from '../security/session.js';
import { validatePassword } from '../validation/index.js';

const GENERIC = new ApiError(401, 'invalid_credentials', 'Invalid email or password');

export async function login({ req, body, deps, cookies }) {
  const { cfg, auth } = deps;
  const ip = shortHash(clientIp(req));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
  const password = typeof body.password === 'string' ? body.password.slice(0, 256) : '';
  await rateLimit(deps, `login:ip:${ip}`, 900, 20);
  await rateLimit(deps, `login:acct`, 900, 10); // single-user app: one global account bucket slows distributed guessing
  if (!email || !password) throw GENERIC;

  const s = await auth.passwordLogin(email, password);
  if (!s || !isOwner(cfg, s.user)) {
    if (s) await auth.signOut(s.accessToken, 'local').catch(() => {}); // valid Supabase user but not the owner
    await audit(deps, 'security', 'auth.login_failed', null, { ip });
    throw GENERIC; // identical response for unknown user, wrong password, or non-owner
  }
  cookies.push(...sessionCookies(cfg, s));
  await audit(deps, 'security', 'auth.login', null, { ip });
  return { body: { ok: true } };
}

export async function logout({ req, deps, cookies }) {
  const { cfg, auth } = deps;
  const token = parseCookies(req.headers.cookie || '')[cookieNames(cfg).access];
  if (token) await auth.signOut(token, 'local').catch(() => {});
  cookies.push(...clearCookies(cfg));
  return { body: { ok: true } };
}

export async function session({ user, deps }) {
  const s = await deps.db.rpc('storage_summary', { p_owner: user.id });
  return { body: { authenticated: true, email: user.email, displayName: s.displayName } };
}

/** Always answers 202 so the endpoint cannot be used to probe which address is the owner's. */
export async function requestReset({ req, body, deps }) {
  const ip = shortHash(clientIp(req));
  await rateLimit(deps, `reset:ip:${ip}`, 3600, 5);
  await rateLimit(deps, 'reset:global', 3600, 10);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email === deps.cfg.ownerEmail) {
    await deps.auth.recover(email).catch(() => {});
    await audit(deps, 'security', 'auth.reset_requested', null, { ip });
  }
  return { status: 202, body: { ok: true } };
}

/** Completes a recovery: the token comes from the verified e-mail link. It must belong to the owner. */
export async function completeReset({ req, body, deps }) {
  await rateLimit(deps, `reset-done:ip:${shortHash(clientIp(req))}`, 3600, 10);
  const password = validatePassword(body.password);
  const token = typeof body.accessToken === 'string' ? body.accessToken : '';
  const user = token ? await deps.auth.getUser(token) : null;
  if (!user || !isOwner(deps.cfg, user)) throw new ApiError(401, 'invalid_link', 'This reset link is invalid or has expired');
  if (!(await deps.auth.updatePassword(token, password))) throw new ApiError(401, 'invalid_link', 'This reset link is invalid or has expired');
  await deps.auth.signOut(token, 'others').catch(() => {});
  await audit(deps, 'security', 'auth.password_reset', null, {});
  return { body: { ok: true } };
}

export async function changePassword({ req, body, deps, user, cookies }) {
  await rateLimit(deps, 'pwchange', 900, 5);
  const next = validatePassword(body.newPassword);
  const s = await deps.auth.passwordLogin(user.email, typeof body.currentPassword === 'string' ? body.currentPassword : '');
  if (!s) throw new ApiError(403, 'invalid_credentials', 'Current password is incorrect');
  if (!(await deps.auth.updatePassword(s.accessToken, next))) throw new ApiError(502, 'auth_unavailable', 'Could not update password');
  await deps.auth.signOut(s.accessToken, 'others').catch(() => {});
  await audit(deps, 'security', 'auth.password_changed', null, {});
  // keep this browser signed in with the fresh session
  cookies.push(...sessionCookies(deps.cfg, s));
  return { body: { ok: true } };
}

export async function signOutOthers({ req, deps }) {
  const token = parseCookies(req.headers.cookie || '')[cookieNames(deps.cfg).access];
  if (token) await deps.auth.signOut(token, 'others');
  await audit(deps, 'security', 'auth.signout_others', null, {});
  return { body: { ok: true } };
}
