// Local development: static files + the same API function Vercel runs. Set APP_ORIGIN=http://localhost:3000 in .env.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './env-file.mjs';
loadDotEnv();
const { default: api } = await import('../api/[...route].js');
const ROOT = join(fileURLToPath(import.meta.url), '..', '..'); const PUB = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const port = Number(process.env.PORT || 3000);
// Apply the same security headers as production (vercel.json) so CSP problems show up in development.
const { readFileSync } = await import('node:fs');
const SEC = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).headers.find((h) => h.source === '/(.*)').headers;
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  for (const { key, value } of SEC) if (key !== 'Strict-Transport-Security') res.setHeader(key, value.replace('; upgrade-insecure-requests', ''));
  if (url.pathname.startsWith('/api/')) return api(req, res);
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  if (p.includes('/.')) { res.statusCode = 404; return res.end('Not found'); }
  try { const b = await readFile(join(PUB, p)); res.setHeader('Content-Type', TYPES[extname(p)] || 'application/octet-stream'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(b); }
  catch { res.statusCode = 404; res.setHeader('Content-Type', 'text/html'); res.end(await readFile(join(PUB, '404.html'))); }
}).listen(port, () => console.log(`LATHISH VAULT dev server: http://localhost:${port}`));
