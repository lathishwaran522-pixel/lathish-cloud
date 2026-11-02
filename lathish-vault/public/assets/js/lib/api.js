export class ApiError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

/** Same-origin API client. Cookies carry the session (HttpOnly); there are no tokens in JS. */
export async function api(path, { method = 'GET', body, query, signal } = {}) {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  let r;
  try {
    r = await fetch(qs ? `${path}?${qs}` : path, {
      method, credentials: 'same-origin', signal, cache: 'no-store',
      headers: { 'X-LV-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'network', 'Network error. Check your connection and try again.');
  }
  let json = null; try { json = await r.json(); } catch { /* no body */ }
  if (r.status === 401 && !path.startsWith('/api/auth/')) { location.replace('/login.html?expired=1'); throw new ApiError(401, 'unauthorized', 'Session expired'); }
  if (!r.ok) throw new ApiError(r.status, json?.error?.code, json?.error?.message || 'Request failed', json?.error);
  return json;
}
