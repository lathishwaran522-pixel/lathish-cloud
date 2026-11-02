import { ApiError } from '../http.js';

/** Thin GoTrue REST client. Runs server-side only; tokens are never returned to JavaScript in the browser. */
export function createAuthClient(cfg, fetchImpl = fetch) {
  const base = `${cfg.supabaseUrl}/auth/v1`;
  async function call(path, { method = 'POST', body, token } = {}) {
    let r;
    try {
      r = await fetchImpl(`${base}${path}`, {
        method,
        headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
      });
    } catch { throw new ApiError(502, 'auth_unavailable', 'Authentication service unavailable'); }
    let json = null; try { json = await r.json(); } catch { /* empty body */ }
    return { status: r.status, json };
  }
  const toSession = (j) => ({ accessToken: j.access_token, refreshToken: j.refresh_token, expiresIn: j.expires_in, user: j.user });
  return {
    async passwordLogin(email, password) {
      const r = await call('/token?grant_type=password', { body: { email, password } });
      if (r.status === 200 && r.json?.access_token) return toSession(r.json);
      if (r.status >= 400 && r.status < 500) return null;
      throw new ApiError(502, 'auth_unavailable', 'Authentication service unavailable');
    },
    async refresh(refreshToken) {
      const r = await call('/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
      if (r.status === 200 && r.json?.access_token) return toSession(r.json);
      if (r.status >= 400 && r.status < 500) return null;
      throw new ApiError(502, 'auth_unavailable', 'Authentication service unavailable');
    },
    async getUser(token) {
      const r = await call('/user', { method: 'GET', token });
      if (r.status === 200 && r.json?.id) return r.json;
      if (r.status === 401 || r.status === 403 || r.status === 404) return null;
      throw new ApiError(502, 'auth_unavailable', 'Authentication service unavailable');
    },
    async recover(email) { await call(`/recover?redirect_to=${encodeURIComponent(`${cfg.appOrigin}/login.html`)}`, { body: { email } }); },
    async updatePassword(token, password) {
      const r = await call('/user', { method: 'PUT', token, body: { password } });
      if (r.status === 200) return true;
      if (r.status === 422 || r.status === 400) throw new ApiError(400, 'weak_password', r.json?.msg || 'Password was rejected');
      return false;
    },
    async signOut(token, scope = 'global') { await call(`/logout?scope=${scope}`, { token }); },
  };
}
