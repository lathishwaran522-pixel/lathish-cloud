import { createApp } from '../lib/app.js';
import { loadConfig } from '../lib/config.js';
import { createAuthClient } from '../lib/supabase/auth.js';
import { createDb } from '../lib/supabase/db.js';
import { createStorage } from '../lib/storage/b2.js';
import { sendJson } from '../lib/http.js';
import { log } from '../lib/security/log.js';

// One serverless function serves every /api/* route (keeps within Vercel Hobby's function limit
// and applies one security pipeline to all endpoints). See lib/routes.js for the route table.
let app;
function build() {
  const cfg = loadConfig(process.env);
  return createApp({ cfg, db: createDb(cfg), auth: createAuthClient(cfg), storage: createStorage(cfg) });
}

export default async function handler(req, res) {
  try { app ??= build(); }
  catch (e) {
    log('error', 'misconfigured', { problems: e.extra?.problems });
    return sendJson(res, 500, { error: { code: 'server_misconfigured', message: 'Server error' } });
  }
  return app(req, res);
}
