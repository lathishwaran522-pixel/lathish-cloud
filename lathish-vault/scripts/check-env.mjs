import { loadDotEnv } from './env-file.mjs';
import { loadConfig } from '../lib/config.js';
loadDotEnv();
try { loadConfig(process.env); console.log('Environment OK (values not shown).'); }
catch (e) { console.error('Environment problems:\n - ' + (e.extra?.problems || [e.message]).join('\n - ')); process.exit(1); }
