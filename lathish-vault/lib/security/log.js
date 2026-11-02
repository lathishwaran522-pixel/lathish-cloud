const SENSITIVE = /pass|token|secret|key|signed|url|authorization|cookie|jwt/i;

/** Structured logs with secret-looking fields redacted. Never log request bodies or signed URLs. */
export function log(level, event, fields = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(fields)) safe[k] = SENSITIVE.test(k) ? '[redacted]' : v;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...safe });
  (level === 'error' ? console.error : console.log)(line);
}
