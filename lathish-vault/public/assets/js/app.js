import { api } from './lib/api.js';
import { $, h, icon, debounce } from './lib/dom.js';
import { formatBytes, pct, relTime, activityText } from './lib/format.js';
import { toast } from './lib/ui.js';
import { UploadQueue } from './upload.js';
import { startBackground, startTicker, addFloaters } from './lib/market.js';
import { closeMenu } from './contextmenu.js';

startBackground($('#bg')); startTicker($('#ticker')); addFloaters($('#floaters'));

const main = $('#main'); const shell = $('#shell'); const queue = new UploadQueue();
let leave = []; let token = 0; let summary = null; let seenActivity = 0;
const ctx = {
  currentFolderId: null, reload: null, fileActions: null,
  onLeave: (f) => leave.push(f), rerender: () => route(),
  pickUpload: () => $('#file-input').click(),
  refreshSummary, logout,
};

async function logout() { try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* cookie cleared server-side when reachable */ } location.replace('/login.html'); }

// ---------- sidebar storage + notifications ----------
async function refreshSummary() {
  try { summary = await api('/api/storage/summary'); } catch { return; }
  const used = summary.usedBytes + summary.reservedBytes; const p = pct(used, summary.quotaBytes);
  const box = $('#side-storage');
  box.replaceChildren(h('div', { class: 'mono' }, `${formatBytes(used)} / ${formatBytes(summary.quotaBytes)}`),
    h('div', { class: `bar${p > 90 ? ' warn' : ''}` }, h('i')), h('div', { class: 'muted' }, `${formatBytes(summary.availableBytes)} available`));
  requestAnimationFrame(() => box.querySelector('.bar > i').style.setProperty('--pct', p.toFixed(2)));
  if (p >= 100) toast('Storage limit reached: the 1 GB vault is full. Free space by deleting items and emptying Trash.', 'err');
  paintNotifs();
}
function paintNotifs() {
  const pop = $('#notif-pop'); const acts = summary?.recentActivity || [];
  pop.replaceChildren(h('h3', {}, 'Recent activity'), acts.length ? h('ul', { class: 'feed' }, acts.slice(0, 8).map((a) => h('li', {}, activityText(a), h('time', {}, relTime(a.at))))) : h('p', { class: 'muted' }, 'Nothing yet.'));
  $('#notif-badge').hidden = !(acts.length && acts[0].id !== seenActivity) || !pop.hidden;
}

// ---------- popovers ----------
function popover(btnId, popId, onOpen) {
  const btn = $(btnId); const pop = $(popId);
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); const open = pop.hidden; document.querySelectorAll('.popover').forEach((p) => { p.hidden = true; }); pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) onOpen?.(); });
  document.addEventListener('click', (e) => { if (!pop.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
}
popover('#notif-btn', '#notif-pop', () => { seenActivity = summary?.recentActivity?.[0]?.id ?? 0; $('#notif-badge').hidden = true; });
popover('#acct-btn', '#acct-pop');
async function paintAccount() {
  const me = await api('/api/auth/session').catch(() => null);
  $('#acct-pop').replaceChildren(h('h3', {}, me?.email || 'Account'),
    h('a', { class: 'menu-item', href: '#/settings' }, icon('sliders', 'sm'), 'Account settings'), h('a', { class: 'menu-item', href: '#/security' }, icon('shield', 'sm'), 'Security'),
    h('button', { class: 'menu-item danger', type: 'button', onclick: logout }, icon('logout', 'sm'), 'Sign out'));
}

// ---------- sidebar ----------
const getPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
if (getPref('lv.collapsed') === '1') shell.classList.add('collapsed');
$('#menu-btn').addEventListener('click', () => {
  if (matchMedia('(max-width: 760px)').matches) shell.classList.toggle('nav-open');
  else { shell.classList.toggle('collapsed'); try { localStorage.setItem('lv.collapsed', shell.classList.contains('collapsed') ? '1' : '0'); } catch { /* ignore */ } }
});
$('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) shell.classList.remove('nav-open'); });

// ---------- search ----------
const search = $('#search');
const doSearch = debounce(() => { const q = search.value.trim(); location.hash = q ? `#/search/${encodeURIComponent(q)}` : '#/files'; }, 300);
search.addEventListener('input', doSearch);
search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; doSearch(); } });

// ---------- uploads ----------
const panel = $('#uploads');
function paintUploads() {
  const items = queue.items; panel.hidden = !items.length; if (!items.length) return;
  const done = items.filter((i) => i.status === 'done').length;
  panel.replaceChildren(h('div', { class: 'up-row' }, h('div', { class: 'top' }, h('strong', { class: 'nm' }, queue.active ? `Uploading · ${done}/${items.length}` : `Uploads · ${done}/${items.length} complete`),
    h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': 'Clear finished uploads', onclick: () => queue.clearFinished() }, icon('x', 'sm')))),
    ...items.slice(-30).map((i) => {
      const p = i.size ? Math.min(100, (i.loaded / i.size) * 100) : 0;
      const bar = h('div', { class: `bar${i.status === 'error' ? ' warn' : ''}`, role: 'progressbar', 'aria-label': `${i.name} progress`, 'aria-valuenow': String(Math.round(p)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i'));
      bar.firstChild.style.setProperty('--pct', p.toFixed(1));
      return h('div', { class: 'up-row' }, h('div', { class: 'top' }, h('span', { class: 'nm', title: i.name }, i.name), h('span', { class: 'muted mono' }, formatBytes(i.size)),
        ['queued', 'uploading'].includes(i.status) ? h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': `Cancel ${i.name}`, onclick: () => queue.cancel(i.id) }, icon('x', 'sm')) : null,
        ['error', 'canceled'].includes(i.status) && i.size ? h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': `Retry ${i.name}`, onclick: () => queue.retry(i.id) }, icon('retry', 'sm')) : null),
        bar, h('span', { class: i.status === 'error' ? 'msg err' : 'muted' }, i.status === 'error' ? i.error : i.status === 'done' ? 'Done' : i.status === 'canceled' ? 'Canceled' : i.status === 'queued' ? 'Waiting…' : `${p.toFixed(0)}%`));
    }));
}
queue.addEventListener('change', paintUploads);
queue.addEventListener('done', (e) => { toast(`Uploaded ${e.detail.name}`, 'ok'); refreshSummary(); ctx.reload?.(); });
queue.addEventListener('failed', (e) => { if (e.detail.status === 'error') toast(`${e.detail.name}: ${e.detail.error}`, 'err'); refreshSummary(); });
const startUpload = (files) => { if (files.length) { queue.add([...files], ctx.currentFolderId); } };
$('#upload-btn').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => { startUpload(e.target.files); e.target.value = ''; });
window.addEventListener('beforeunload', (e) => { if (queue.active) { e.preventDefault(); e.returnValue = ''; } });

// drag & drop from the desktop (internal moves use a different data type and are ignored here)
const dz = $('#dropzone'); let depth = 0;
const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; dz.classList.add('on'); } });
window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; dz.classList.remove('on'); } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; dz.classList.remove('on'); startUpload(e.dataTransfer.files); });

// ---------- router ----------
const NAV = { dashboard: 'dashboard', files: 'files', recent: 'recent', favorites: 'favorites', trash: 'trash', analytics: 'analytics', settings: 'settings', security: 'security', file: 'files', search: 'files' };
async function route() {
  const my = ++token; leave.forEach((f) => { try { f(); } catch { /* ignore */ } }); leave = []; closeMenu(); ctx.reload = null;
  const [, name = 'dashboard', arg] = (location.hash || '#/dashboard').split('/');
  const key = NAV[name] ? name : 'dashboard';
  document.querySelectorAll('[data-nav]').forEach((a) => (a.dataset.nav === NAV[key] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  main.replaceChildren(h('div', { class: 'skeleton skeleton-row' }), h('div', { class: 'skeleton skeleton-row' }), h('div', { class: 'skeleton skeleton-row' }));
  const files = () => import('./views/files.js');
  try {
    let mod; let opts;
    if (key === 'files') { mod = await files(); opts = { view: 'folder', parent: arg || null }; if (arg && !/^[0-9a-f-]{36}$/i.test(arg)) { location.hash = '#/files'; return; } }
    else if (key === 'search') { mod = await files(); opts = { view: 'search', q: decodeURIComponent(arg || '') }; if (search.value !== opts.q) search.value = opts.q; }
    else if (['recent', 'favorites', 'trash'].includes(key)) { mod = await files(); opts = { view: key }; }
    else if (key === 'file') { mod = await import('./views/details.js'); opts = { id: arg }; }
    else mod = await import(`./views/${key}.js`);
    if (my !== token) return;
    document.title = `${key[0].toUpperCase()}${key.slice(1)} · LATHISH VAULT`;
    await mod.render(main, ctx, opts);
    if (key !== 'search' && search.value && key !== 'files') search.value = '';
    main.focus({ preventScroll: true });
  } catch (e) { if (my === token) main.replaceChildren(h('div', { class: 'empty', role: 'alert' }, icon('alert'), h('p', {}, 'Could not load this page.'), h('button', { class: 'btn', type: 'button', onclick: route }, 'Retry'))); }
}
window.addEventListener('hashchange', route);
refreshSummary(); paintAccount(); route();
