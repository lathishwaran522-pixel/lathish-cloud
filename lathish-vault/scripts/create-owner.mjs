// Creates the single owner in Supabase Auth (confirmed) and the vault_profile row. Run once.
// Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_EMAIL in .env. The password is prompted (hidden) and never stored by this script.
import readline from 'node:readline';
import { loadDotEnv } from './env-file.mjs';
loadDotEnv();
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OWNER_EMAIL } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !OWNER_EMAIL) { console.error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OWNER_EMAIL first.'); process.exit(1); }

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}
const password = await askHidden('Choose the owner password (12+ chars): ');
if (password.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(1); }
const headers = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const base = SUPABASE_URL.replace(/\/$/, '');
const u = await fetch(`${base}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email: OWNER_EMAIL, password, email_confirm: true }) });
const uj = await u.json().catch(() => ({}));
if (!u.ok) { console.error(`Could not create the user (HTTP ${u.status}): ${uj.msg || uj.message || 'unknown error'}`); process.exit(1); }
const p = await fetch(`${base}/rest/v1/vault_profile`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ owner_id: uj.id }) });
if (!p.ok) { console.error(`User created, but the vault_profile insert failed (HTTP ${p.status}). Did you apply the migrations?`); console.error(`Insert it manually with owner_id = ${uj.id}`); process.exit(1); }
console.log(`\nOwner created.\nSet this in Vercel / .env:\n  OWNER_USER_ID=${uj.id}\nThen disable public sign-ups in Supabase (Authentication > Sign In / Providers).`);
