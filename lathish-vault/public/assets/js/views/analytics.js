import { api } from '../lib/api.js';
import { h, icon } from '../lib/dom.js';
import { formatBytes, pct } from '../lib/format.js';
import { lineChart, barChart, donut, PALETTE } from '../lib/charts.js';
import { toast } from '../lib/ui.js';

export async function render(root, ctx) {
  ctx.currentFolderId = null;
  root.replaceChildren(h('div', { class: 'skeleton skeleton-row' }), h('div', { class: 'skeleton skeleton-row' }));
  const ac = new AbortController(); ctx.onLeave(() => ac.abort());
  let s;
  try { s = await api('/api/storage/summary', { signal: ac.signal }); }
  catch (e) { if (e.name !== 'AbortError') root.replaceChildren(h('div', { class: 'empty', role: 'alert' }, icon('alert'), h('p', {}, e.message), h('button', { class: 'btn', type: 'button', onclick: () => ctx.rerender() }, 'Retry'))); return; }
  const used = s.usedBytes + s.reservedBytes; const p = pct(used, s.quotaBytes);
  const line = h('canvas', { class: 'chart', role: 'img', 'aria-label': 'Storage usage over time' });
  const bars = h('canvas', { class: 'chart', role: 'img', 'aria-label': 'Uploads per day' });
  const ring = h('canvas', { class: 'chart', role: 'img', 'aria-label': 'Storage by type' });
  const rows = s.byType.sort((a, b) => b.bytes - a.bytes);
  root.replaceChildren(h('div', { class: 'page-in' }, h('div', { class: 'page-head' }, h('h1', {}, 'Storage Analytics')),
    h('div', { class: 'grid cols-4' },
      card('Quota', formatBytes(s.quotaBytes), '1,000,000,000 bytes'), card('Used', formatBytes(s.usedBytes), `${p.toFixed(2)}%`),
      card('Reserved by uploads', formatBytes(s.reservedBytes), 'in-flight'), card('In Trash', formatBytes(s.trashBytes), `${s.trashCount} item(s), still counted`)),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card glass' }, h('h2', {}, 'Usage over time'), line),
      h('section', { class: 'card glass' }, h('h2', {}, 'Uploads · last 14 days'), bars),
      h('section', { class: 'card glass' }, h('h2', {}, 'By file type'), ring,
        h('div', { class: 'legend' }, rows.map((r, i) => h('span', {}, h('i', { class: `sw sw${i % 6}` }), `${r.type}: ${formatBytes(r.bytes)} (${r.count})`)))),
      h('section', { class: 'card glass' }, h('h2', {}, 'Inventory'),
        h('ul', { class: 'feed' }, h('li', {}, 'Files', h('time', {}, String(s.fileCount))), h('li', {}, 'Folders', h('time', {}, String(s.folderCount))), h('li', {}, 'Available', h('time', {}, formatBytes(s.availableBytes)))),
        h('p', { class: 'muted' }, 'Counters are kept transactionally. If they ever look wrong, recompute them from committed files.'),
        h('button', { class: 'btn', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { await api('/api/storage/recompute', { method: 'POST', body: {} }); toast('Usage recomputed', 'ok'); ctx.rerender(); } catch (er) { toast(er.message, 'err'); e.currentTarget.disabled = false; } } }, icon('retry', 'sm'), 'Recompute usage')))));
  const draw = () => {
    lineChart(line, s.history.map((x) => ({ label: x.day.slice(5), value: x.usedBytes })), { fmt: formatBytes, max: 0 });
    barChart(bars, s.uploadsByDay.map((x) => ({ label: x.day.slice(5), value: x.count })));
    donut(ring, rows.map((r) => ({ value: r.bytes })));
  };
  requestAnimationFrame(draw); window.addEventListener('resize', draw); ctx.onLeave(() => window.removeEventListener('resize', draw));
}
const card = (l, v, sub) => h('section', { class: 'card glass' }, h('h2', {}, l), h('div', { class: 'stat' }, v), h('div', { class: 'muted' }, sub));
