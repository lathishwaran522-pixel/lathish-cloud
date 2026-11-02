import { createHash } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status; this.code = code; this.extra = extra;
  }
}

export function sendJson(res, status, body, cookies = []) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.end(JSON.stringify(body));
}

export async function readJson(req, limit = 64 * 1024) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'object') return req.body;
    try { return JSON.parse(req.body); } catch { throw new ApiError(400, 'invalid_json', 'Request body must be JSON'); }
  }
  if (typeof req[Symbol.asyncIterator] !== 'function') return {};
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new ApiError(413, 'body_too_large', 'Request body too large');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'invalid_json', 'Request body must be JSON'); }
}

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  return (typeof xff === 'string' ? xff.split(',')[0].trim() : null) || req.headers['x-real-ip'] || 'unknown';
}
export const shortHash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 24);
