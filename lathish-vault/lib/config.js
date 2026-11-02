import { ApiError } from './http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUIRED = [
  'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'OWNER_USER_ID', 'OWNER_EMAIL',
  'B2_ENDPOINT', 'B2_BUCKET', 'B2_KEY_ID', 'B2_APPLICATION_KEY',
  'APP_ORIGIN', 'CRON_SECRET',
];
export const ENV_NAMES = [...REQUIRED, 'BLOCKED_EXTENSIONS'];

/** Validate env. Throws with variable NAMES only, never values. */
export function loadConfig(env = process.env) {
  const problems = [];
  for (const k of REQUIRED) if (!env[k] || !String(env[k]).trim()) problems.push(`${k} is missing`);
  const url = (k, httpsOnly = true) => {
    try {
      const u = new URL(env[k]);
      if (httpsOnly && u.protocol !== 'https:' && !(u.hostname === 'localhost' || u.hostname === '127.0.0.1')) problems.push(`${k} must be https`);
      if (u.pathname !== '/' && k !== 'SUPABASE_URL') problems.push(`${k} must not contain a path`);
      return u;
    } catch { if (env[k]) problems.push(`${k} is not a valid URL`); return null; }
  };
  if (env.SUPABASE_URL) url('SUPABASE_URL');
  if (env.B2_ENDPOINT) url('B2_ENDPOINT');
  const origin = env.APP_ORIGIN ? url('APP_ORIGIN') : null;
  if (env.APP_ORIGIN && env.APP_ORIGIN.endsWith('/')) problems.push('APP_ORIGIN must not end with "/"');
  if (env.OWNER_USER_ID && !UUID.test(env.OWNER_USER_ID)) problems.push('OWNER_USER_ID must be a UUID');
  if (env.CRON_SECRET && env.CRON_SECRET.length < 32) problems.push('CRON_SECRET must be at least 32 characters');
  if (problems.length) throw new ApiError(500, 'server_misconfigured', 'Server configuration is invalid', { problems });

  const b2 = new URL(env.B2_ENDPOINT);
  const region = (b2.hostname.match(/^s3\.([^.]+)\.backblazeb2\.com$/) || [])[1] || 'us-west-004';
  const blocked = (env.BLOCKED_EXTENSIONS ?? 'scr,pif,vbs,bat,cmd,com')
    .split(',').map((s) => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean);
  return Object.freeze({
    supabaseUrl: env.SUPABASE_URL.replace(/\/$/, ''),
    anonKey: env.SUPABASE_ANON_KEY,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    ownerId: env.OWNER_USER_ID.toLowerCase(),
    ownerEmail: env.OWNER_EMAIL.trim().toLowerCase(),
    b2Endpoint: env.B2_ENDPOINT, b2Region: region, b2Bucket: env.B2_BUCKET,
    b2KeyId: env.B2_KEY_ID, b2AppKey: env.B2_APPLICATION_KEY,
    appOrigin: env.APP_ORIGIN, secureCookies: origin.protocol === 'https:',
    cronSecret: env.CRON_SECRET, blockedExtensions: Object.freeze(blocked),
  });
}
