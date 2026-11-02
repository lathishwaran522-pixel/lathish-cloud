// Dependency-free code-quality gate: syntax check + security lint for this project's own rules.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const SKIP = new Set(['node_modules', '.git', '.vercel']);
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) { if (SKIP.has(n)) continue; const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
}
export function runChecks() {
  const problems = []; const files = walk(ROOT);
  for (const f of files) {
    const rel = relative(ROOT, f); const ext = extname(f); const text = ['.js', '.mjs', '.html', '.css', '.json', '.sql', '.md', '.svg'].includes(ext) ? readFileSync(f, 'utf8') : '';
    if (['.js', '.mjs'].includes(ext)) { const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); if (r.status !== 0) problems.push(`${rel}: syntax error\n${r.stderr}`); }
    if (rel.startsWith('public/assets/js') && ext === '.js') {
      for (const bad of [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function\s*\(/, /setAttribute\(\s*['"]style/, /service_role|SERVICE_ROLE|B2_APPLICATION_KEY/])
        if (bad.test(text)) problems.push(`${rel}: forbidden pattern ${bad}`);
    }
    if (ext === '.html') {
      if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(text)) problems.push(`${rel}: inline <script> (blocked by CSP)`);
      if (/\sstyle\s*=/i.test(text)) problems.push(`${rel}: inline style attribute (blocked by CSP)`);
      if (/\son[a-z]+\s*=/i.test(text)) problems.push(`${rel}: inline event handler (blocked by CSP)`);
    }
    if (text && !rel.startsWith('tests') && !rel.endsWith('.md') && rel !== '.env.example' && /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{10,}/.test(text)) problems.push(`${rel}: JWT-looking secret`);
    if (rel === '.env' || (rel.startsWith('.env.') && rel !== '.env.example')) problems.push(`${rel}: env file must not be committed`);
  }
  return problems;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const p = runChecks();
  if (p.length) { console.error(p.join('\n')); process.exit(1); }
  console.log('code checks passed');
}
