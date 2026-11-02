import { api } from '../lib/api.js';
import { h, icon } from '../lib/dom.js';
import { formatBytes, pct, relTime, activityText, kindOf } from '../lib/format.js';
import { lineChart } from '../lib/charts.js';
import { startBackground } from '../lib/market.js';

const greet = () => { const t = new Date().getHours(); return t < 5 ? 'Good evening' : t < 12 ? 'Good morning' : t < 18 ? 'Good afternoon' : 'Good evening'; };

export async function render(root, ctx) {
  ctx.currentFolderId = null;
  root.replaceChildren(h('div', { class: 'grid cols-4' }, ...Array.from({ length: 4 }, () => h('div', { class: 'skeleton skeleton-row' })))); 
  const ac = new AbortController(); ctx.onLeave(() => ac.abort());
  let s; let recent;
  try {
    [s, recent] = await Promise.all([api('/api/storage/summary', { signal: ac.signal }), api('/api/files/list', { signal: ac.signal, query: { view: 'recent', limit: 6 } })]);
  } catch (e) { if (e.name !== 'AbortError') root.replaceChildren(h('div', { class: 'empty', role: 'alert' }, icon('alert'), h('p', {}, e.message), h('button', { class: 'btn', type: 'button', onclick: () => ctx.rerender() }, 'Retry'))); return; }

  const used = s.usedBytes + s.reservedBytes; const p = pct(used, s.quotaBytes);
  const miniBg = h('canvas', { class: 'chart', 'aria-hidden': 'true' });
  const growth = h('canvas', { class: 'chart', role: 'img', 'aria-label': 'Storage growth over time' });
  const input = h('input', { type: 'file', multiple: true, hidden: true });

  root.replaceChildren(h('div', { class: 'page-in' },
    h('section', { class: 'hero glass' },
      h('h1', {}, `${greet()}, ${s.displayName}`), h('p', {}, `${formatBytes(s.availableBytes)} of your ${formatBytes(s.quotaBytes)} allocation is available.`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.pickUpload() }, icon('upload', 'sm'), 'Upload files'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { location.hash = '#/files'; setTimeout(() => ctx.fileActions?.newFolder(), 400); } }, icon('folder-plus', 'sm'), 'New folder'),
        h('a', { class: 'btn', href: '#/files' }, icon('folder', 'sm'), 'Browse files'),
        h('a', { class: 'btn', href: '#/trash' }, icon('trash', 'sm'), `Trash (${s.trashCount})`)), input),
    h('div', { class: 'grid cols-4' },
      stat('Total allocation', formatBytes(s.quotaBytes), 'fixed quota'), stat('Used capacity', formatBytes(used), `${p.toFixed(2)}% of allocation`, 'up'),
      stat('Available', formatBytes(s.availableBytes), 'free to deploy'), stat('Holdings', `${s.fileCount}`, `files · ${s.folderCount} folders`)),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card glass' }, h('h2', {}, 'Storage portfolio'),
        h('div', { class: `bar${p > 90 ? ' warn' : ''}`, role: 'progressbar', 'aria-valuenow': p.toFixed(1), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Storage used' }, h('i')), growth,
        h('div', { class: 'legend' }, h('span', {}, 'Growth over time (committed usage)'))),
      h('section', { class: 'card glass' }, h('h2', {}, 'Market view ', h('span', { class: 'pill' }, 'SIMULATED')), miniBg, h('p', { class: 'muted' }, 'Decorative animation. These candles are generated randomly and are not live market data.'))),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card glass' }, h('h2', {}, 'Recent files'),
        recent.items.length ? h('ul', { class: 'feed' }, recent.items.map((f) => h('li', {}, icon(kindOf(f) === 'image' ? 'image' : kindOf(f) === 'pdf' ? 'pdf' : 'file', 'sm'), h('a', { href: `#/file/${f.id}` }, f.name), h('span', { class: 'muted mono' }, formatBytes(f.size)), h('time', {}, relTime(f.updatedAt)))))
          : h('p', { class: 'muted' }, 'Nothing uploaded yet. Use Upload files to get started.')),
      h('section', { class: 'card glass' }, h('h2', {}, 'File activity'),
        s.recentActivity.length ? h('ul', { class: 'feed' }, s.recentActivity.slice(0, 8).map((a) => h('li', {}, h('span', {}, activityText(a)), h('time', {}, relTime(a.at))))) : h('p', { class: 'muted' }, 'No activity yet.')))));

  root.querySelectorAll('.skeleton').forEach((n) => n.remove());
  const draw = () => lineChart(growth, s.history.map((x) => ({ label: x.day.slice(5), value: x.usedBytes })), { fmt: formatBytes });
  requestAnimationFrame(draw);
  const stop = startBackground(miniBg); ctx.onLeave(stop);
  const onResize = () => draw(); window.addEventListener('resize', onResize); ctx.onLeave(() => window.removeEventListener('resize', onResize));
  requestAnimationFrame(() => root.querySelector('.bar > i')?.style.setProperty('--pct', p.toFixed(2)));
}

function stat(label, value, sub, cls = '') {
  return h('section', { class: 'card glass' }, h('h2', {}, label), h('div', { class: `stat ${cls}` }, value), h('div', { class: 'muted' }, sub));
}
