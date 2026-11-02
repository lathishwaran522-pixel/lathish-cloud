export function cookieNames(cfg) {
  const p = cfg.secureCookies ? '__Host-' : '';
  return { access: `${p}lv_at`, refresh: `${p}lv_rt` };
}
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ } }
  }
  return out;
}
function serialize(name, value, cfg, maxAge) {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    `Max-Age=${maxAge}`, ...(cfg.secureCookies ? ['Secure'] : [])].join('; ');
}
export function sessionCookies(cfg, { accessToken, refreshToken, expiresIn }) {
  const n = cookieNames(cfg);
  return [serialize(n.access, accessToken, cfg, Math.max(60, Math.min(expiresIn || 3600, 86400))),
          serialize(n.refresh, refreshToken, cfg, 30 * 24 * 3600)];
}
export function clearCookies(cfg) {
  const n = cookieNames(cfg);
  return [serialize(n.access, '', cfg, 0), serialize(n.refresh, '', cfg, 0)];
}
