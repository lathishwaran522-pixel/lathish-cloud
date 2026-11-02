import { api } from '../lib/api.js';
import { h, icon } from '../lib/dom.js';
import { formatBytes, fullDate, kindOf } from '../lib/format.js';
import { toast, promptDialog, confirmDialog } from '../lib/ui.js';
import { download, renderPreview } from '../preview.js';

export async function render(root, ctx, { id }) {
  ctx.currentFolderId = null;
  root.replaceChildren(h('div', { class: 'skeleton skeleton-row' }));
  const ac = new AbortController(); ctx.onLeave(() => ac.abort());
  let r;
  try { r = await api('/api/files/get', { signal: ac.signal, query: { id } }); }
  catch (e) { if (e.name !== 'AbortError') root.replaceChildren(h('div', { class: 'empty', role: 'alert' }, icon('alert'), h('h2', {}, e.status === 404 ? 'File not found' : 'Could not load file'), h('p', {}, e.message), h('a', { class: 'btn', href: '#/files' }, 'Back to files'))); return; }
  const n = r.node; const pv = h('div', { class: 'preview' }); const parentHref = n.parentId ? `#/files/${n.parentId}` : '#/files';
  const act = (fn, msg) => async () => { try { await fn(); toast(msg, 'ok'); } catch (e) { toast(e.message, 'err'); } };
  root.replaceChildren(h('div', { class: 'page-in' },
    h('div', { class: 'page-head' }, h('a', { class: 'btn ghost', href: parentHref }, '← Back'), h('h1', {}, n.name)),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card glass' }, h('h2', {}, 'Details'),
        h('div', { class: 'details' }, h('dl', {},
          h('dt', {}, 'Kind'), h('dd', {}, kindOf(n)), h('dt', {}, 'MIME'), h('dd', {}, n.mimeType || '—'), h('dt', {}, 'Size'), h('dd', {}, `${formatBytes(n.size)} (${n.size.toLocaleString()} bytes)`),
          h('dt', {}, 'Location'), h('dd', {}, `/${n.path.split('/').slice(0, -1).join('/')}`), h('dt', {}, 'Created'), h('dd', {}, fullDate(n.createdAt)), h('dt', {}, 'Modified'), h('dd', {}, fullDate(n.updatedAt)),
          h('dt', {}, 'Status'), h('dd', {}, n.status), h('dt', {}, 'ID'), h('dd', { class: 'mono' }, n.id))),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: act(() => download(n), 'Download started') }, icon('download', 'sm'), 'Download'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { const name = await promptDialog({ title: 'Rename', label: 'New name', value: n.name }); if (name) act(async () => { await api('/api/files/rename', { method: 'POST', body: { id: n.id, name } }); ctx.rerender(); }, 'Renamed')(); } }, icon('edit', 'sm'), 'Rename'),
          h('button', { class: 'btn', type: 'button', onclick: act(async () => { await api('/api/files/favorite', { method: 'POST', body: { id: n.id, value: !n.favorite } }); ctx.rerender(); }, 'Updated') }, icon('star', 'sm'), n.favorite ? 'Unfavorite' : 'Favorite'),
          h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Move to Trash?', body: n.name, confirmLabel: 'Move to Trash', danger: true })) act(async () => { await api('/api/files/trash', { method: 'POST', body: { ids: [n.id] } }); location.hash = parentHref; }, 'Moved to Trash')(); } }, icon('trash', 'sm'), 'Trash'))),
      h('section', { class: 'card glass' }, h('h2', {}, 'Preview'), pv))));
  if (n.kind === 'file' && n.status === 'active') renderPreview(pv, n); else pv.replaceChildren(h('p', { class: 'muted' }, 'No preview available.'));
}
