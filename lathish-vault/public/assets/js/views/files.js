import { api } from '../lib/api.js';
import { h, icon, fill } from '../lib/dom.js';
import { formatBytes, relTime, fullDate, kindOf } from '../lib/format.js';
import { toast, confirmDialog, promptDialog, pickFolder } from '../lib/ui.js';
import { download, renderPreview } from '../preview.js';
import { openMenu } from '../contextmenu.js';

const ICON = { folder: 'folder', image: 'image', pdf: 'pdf', text: 'text', video: 'video', audio: 'audio', archive: 'archive', file: 'file' };
const pref = (k, d) => { try { return localStorage.getItem(`lv.${k}`) || d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(`lv.${k}`, v); } catch { /* private mode */ } };

/** Explorer for folder / recent / favorites / trash / search views. */
export async function render(root, ctx, { view, parent = null, q = '' }) {
  const S = { items: [], total: 0, crumbs: [], sel: new Set(), mode: pref('mode', 'grid'), sort: pref('sort', 'name'), dir: pref('dir', 'asc'), offset: 0, loading: false, detail: null };
  const ac = new AbortController(); ctx.onLeave(() => ac.abort());
  ctx.currentFolderId = view === 'folder' ? parent : null;
  const trashView = view === 'trash';

  const head = h('div', { class: 'page-head' }); const bar = h('div', { class: 'toolbar' });
  const list = h('div', { class: 'files', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Files and folders' });
  const more = h('div'); const side = h('aside', { class: 'details glass', hidden: true, 'aria-label': 'Details' });
  const wrap = h('div', { class: 'explorer page-in' }, h('div', {}, bar, list, more), side);
  root.replaceChildren(head, wrap);

  const title = { folder: 'All Files', recent: 'Recent Files', favorites: 'Favorites', trash: 'Trash', search: `Search: “${q}”` }[view];
  const sel = () => S.items.filter((i) => S.sel.has(i.id));

  async function load(reset = true) {
    if (S.loading) return; S.loading = true;
    if (reset) { S.offset = 0; list.className = 'files'; list.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'skeleton skeleton-row' }))); }
    try {
      const r = await api('/api/files/list', { signal: ac.signal, query: { view, parent: parent || 'root', q, sort: S.sort, dir: S.dir, offset: S.offset, limit: 100 } });
      S.items = reset ? r.items : [...S.items, ...r.items]; S.total = r.total; S.crumbs = r.breadcrumbs || []; S.offset = S.items.length;
      if (reset) S.sel.clear();
      paint();
    } catch (e) {
      if (e.name === 'AbortError') return;
      list.className = 'files'; list.replaceChildren(h('div', { class: 'empty', role: 'alert' }, icon('alert'), h('p', {}, e.message), h('button', { class: 'btn', type: 'button', onclick: () => load() }, icon('retry', 'sm'), 'Retry')));
    } finally { S.loading = false; }
  }
  ctx.reload = () => load(true);

  function paintHead() {
    head.replaceChildren();
    if (view === 'folder') {
      const nav = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, S.crumbs.length ? h('a', { href: '#/files' }, 'All Files') : h('span', { 'aria-current': 'page' }, 'All Files'));
      S.crumbs.forEach((c, i) => { nav.append(h('span', { class: 'sep', 'aria-hidden': 'true' }, '/'), i === S.crumbs.length - 1 ? h('span', { 'aria-current': 'page' }, c.name) : h('a', { href: `#/files/${c.id}` }, c.name)); });
      head.append(h('h1', { class: 'sr-only' }, title), nav);
    } else head.append(h('h1', {}, title), h('span', { class: 'pill' }, `${S.total} item${S.total === 1 ? '' : 's'}`));
  }

  function paintBar() {
    const n = S.sel.size; bar.replaceChildren();
    const sortSel = h('select', { class: 'input', 'aria-label': 'Sort by', onchange: (e) => { S.sort = e.target.value; setPref('sort', S.sort); load(); } },
      ...['name', 'size', 'type', 'modified'].map((k) => h('option', { value: k, selected: S.sort === k }, `Sort: ${k}`)));
    const dirBtn = h('button', { class: 'btn icon ghost', type: 'button', 'aria-label': `Sort ${S.dir === 'asc' ? 'ascending' : 'descending'}. Click to reverse`, onclick: () => { S.dir = S.dir === 'asc' ? 'desc' : 'asc'; setPref('dir', S.dir); load(); } }, S.dir === 'asc' ? '↑' : '↓');
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'View' },
      h('button', { type: 'button', 'aria-pressed': S.mode === 'grid', 'aria-label': 'Grid view', onclick: () => { S.mode = 'grid'; setPref('mode', 'grid'); paint(); } }, icon('grid', 'sm')),
      h('button', { type: 'button', 'aria-pressed': S.mode === 'list', 'aria-label': 'List view', onclick: () => { S.mode = 'list'; setPref('mode', 'list'); paint(); } }, icon('list', 'sm')));
    if (view === 'folder') bar.append(h('button', { class: 'btn', type: 'button', onclick: newFolder }, icon('folder-plus', 'sm'), h('span', { class: 'lbl' }, 'New folder')));
    if (trashView) bar.append(h('button', { class: 'btn danger', type: 'button', disabled: !S.total, onclick: emptyTrash }, icon('trash', 'sm'), h('span', { class: 'lbl' }, 'Empty Trash')));
    if (n) {
      bar.append(h('span', { class: 'pill', role: 'status' }, `${n} selected`));
      if (trashView) bar.append(h('button', { class: 'btn', type: 'button', onclick: () => restore(sel()) }, icon('restore', 'sm'), h('span', { class: 'lbl' }, 'Restore')),
        h('button', { class: 'btn danger', type: 'button', onclick: () => purge(sel()) }, icon('trash', 'sm'), h('span', { class: 'lbl' }, 'Delete permanently')));
      else bar.append(h('button', { class: 'btn', type: 'button', onclick: () => move(sel()) }, icon('move', 'sm'), h('span', { class: 'lbl' }, 'Move')),
        h('button', { class: 'btn danger', type: 'button', onclick: () => trash(sel()) }, icon('trash', 'sm'), h('span', { class: 'lbl' }, 'Trash')));
    }
    bar.append(h('span', { class: 'spacer' }), ...(trashView ? [] : [sortSel, dirBtn]), seg);
  }

  function row(node) {
    const kind = kindOf(node); const isFolder = node.kind === 'folder';
    const el = h('div', { class: 'item', role: 'option', tabindex: '0', 'aria-selected': String(S.sel.has(node.id)), dataset: { id: node.id }, draggable: !trashView },
      h('span', { class: `kind ${kind}` }, icon(ICON[kind], S.mode === 'grid' ? 'lg' : '')),
      h('div', { class: 'info' },
        h('div', {}, h('div', { class: 'name' }, node.name), node.path && view !== 'folder' ? h('span', { class: 'path mono' }, `/${node.path.split('/').slice(0, -1).join('/')}`) : null),
        h('span', { class: 'meta' }, isFolder ? '—' : formatBytes(node.size)),
        h('span', { class: 'meta when' }, trashView ? `deleted ${relTime(node.trashedAt)}` : relTime(node.updatedAt))),
      node.favorite ? h('span', { class: 'star', title: 'Favorite' }, icon('star')) : null,
      h('button', { class: 'more', type: 'button', 'aria-label': `Actions for ${node.name}`, 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); menuFor(node, r.left, r.bottom, e.currentTarget); } }, icon('more', 'sm')));
    el.addEventListener('click', (e) => { if (e.target.closest('.more')) return; select(node, e.ctrlKey || e.metaKey || e.shiftKey); });
    el.addEventListener('dblclick', () => open(node));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!S.sel.has(node.id)) select(node, false); menuFor(node, e.clientX, e.clientY, el); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); open(node); }
      else if (e.key === ' ') { e.preventDefault(); select(node, true); }
      else if (e.key === 'Delete' && !trashView) trash(sel().length ? sel() : [node]);
      else if (e.key === 'F2' && !trashView) rename(node);
      else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = el.getBoundingClientRect(); menuFor(node, r.left + 20, r.top + 20, el); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); el.nextElementSibling?.focus(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); el.previousElementSibling?.focus(); }
    });
    if (!trashView) {
      el.addEventListener('dragstart', (e) => { const ids = S.sel.has(node.id) ? [...S.sel] : [node.id]; e.dataTransfer.setData('application/x-lv-ids', JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'move'; });
      if (isFolder) {
        el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-lv-ids')) { e.preventDefault(); el.classList.add('drop'); } });
        el.addEventListener('dragleave', () => el.classList.remove('drop'));
        el.addEventListener('drop', async (e) => {
          e.preventDefault(); el.classList.remove('drop');
          const ids = JSON.parse(e.dataTransfer.getData('application/x-lv-ids') || '[]').filter((i) => i !== node.id);
          await moveIds(ids, node.id);
        });
      }
    }
    return el;
  }

  function paint() {
    paintHead(); paintBar();
    list.className = `files ${S.mode === 'grid' ? 'grid-view' : 'list-view'}`;
    if (!S.items.length) {
      const msg = { folder: ['folder', 'This folder is empty', 'Drop files here or use Upload.'], recent: ['clock', 'No recent files', 'Uploads will show up here.'],
        favorites: ['star', 'No favorites yet', 'Use the ⋯ menu to favorite items.'], trash: ['trash', 'Trash is empty', 'Deleted items keep counting toward your 1 GB until removed.'],
        search: ['search', 'No matches', `Nothing found for “${q}”.`] }[view];
      list.className = 'files'; list.replaceChildren(h('div', { class: 'empty' }, icon(msg[0]), h('h2', {}, msg[1]), h('p', {}, msg[2]))); more.replaceChildren(); paintSide(); return;
    }
    list.replaceChildren(...S.items.map(row));
    fill(more, S.items.length < S.total ? h('p', {}, h('button', { class: 'btn', type: 'button', onclick: () => load(false) }, `Load more (${S.total - S.items.length} remaining)`)) : null);
    paintSide();
  }

  function select(node, additive) {
    if (additive) S.sel.has(node.id) ? S.sel.delete(node.id) : S.sel.add(node.id); else { S.sel.clear(); S.sel.add(node.id); }
    for (const el of list.children) if (el.dataset?.id) el.setAttribute('aria-selected', String(S.sel.has(el.dataset.id)));
    paintBar(); paintSide();
  }

  function paintSide() {
    const one = S.sel.size === 1 ? S.items.find((i) => S.sel.has(i.id)) : null;
    wrap.classList.toggle('with-details', !!one); side.hidden = !one; if (!one) return;
    const kind = kindOf(one); const pv = h('div', { class: 'preview', hidden: true });
    side.replaceChildren(h('div', { class: `kind ${kind}` }, icon(ICON[kind], 'lg')), h('h2', {}, one.name),
      h('dl', {}, h('dt', {}, 'Type'), h('dd', {}, one.kind === 'folder' ? 'Folder' : one.mimeType || 'File'), h('dt', {}, 'Size'), h('dd', {}, one.kind === 'folder' ? '—' : formatBytes(one.size)),
        h('dt', {}, 'Modified'), h('dd', {}, fullDate(one.updatedAt)), one.path ? [h('dt', {}, 'Path'), h('dd', {}, `/${one.path}`)] : null),
      h('div', { class: 'actions' },
        one.kind === 'file' && !trashView ? h('button', { class: 'btn', type: 'button', onclick: () => { pv.hidden = false; renderPreview(pv, one); } }, 'Preview') : null,
        one.kind === 'file' && !trashView ? h('button', { class: 'btn', type: 'button', onclick: () => download(one).catch((e) => toast(e.message, 'err')) }, icon('download', 'sm'), 'Download') : null,
        one.kind === 'file' && !trashView ? h('a', { class: 'btn', href: `#/file/${one.id}` }, 'Details') : null),
      pv);
  }

  // ---- actions (every one hits the API; UI reloads from server truth) ----
  const guard = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg, 'ok'); } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'err'); } await Promise.all([load(), ctx.refreshSummary()]); };
  const open = (node) => (node.kind === 'folder' && !trashView ? (location.hash = `#/files/${node.id}`) : node.kind === 'file' && !trashView ? (location.hash = `#/file/${node.id}`) : null);
  const newFolder = async () => { const name = await promptDialog({ title: 'New folder', label: 'Folder name', confirmLabel: 'Create' }); if (name) guard(() => api('/api/folders/create', { method: 'POST', body: { parentId: parent, name } }), 'Folder created'); };
  const rename = async (node) => { const name = await promptDialog({ title: 'Rename', label: 'New name', value: node.name, confirmLabel: 'Rename' }); if (name && name !== node.name) guard(() => api('/api/files/rename', { method: 'POST', body: { id: node.id, name } }), 'Renamed'); };
  const trash = (nodes) => guard(() => api('/api/files/trash', { method: 'POST', body: { ids: nodes.map((n) => n.id) } }), 'Moved to Trash');
  const restore = (nodes) => guard(() => api('/api/files/restore', { method: 'POST', body: { ids: nodes.map((n) => n.id) } }), 'Restored');
  const fav = (node) => guard(() => api('/api/files/favorite', { method: 'POST', body: { id: node.id, value: !node.favorite } }));
  async function moveIds(ids, parentId) { await guard(async () => { for (const id of ids) await api('/api/files/move', { method: 'POST', body: { id, parentId } }); }, 'Moved'); }
  async function move(nodes) { const dest = await pickFolder(api, { exclude: nodes.map((n) => n.id) }); if (dest) moveIds(nodes.map((n) => n.id), dest.id); }
  async function purge(nodes) {
    if (!await confirmDialog({ title: 'Delete permanently?', body: `${nodes.length} item(s) and everything inside will be erased from storage. This cannot be undone.`, confirmLabel: 'Delete permanently', danger: true })) return;
    guard(() => api('/api/files/purge', { method: 'POST', body: { ids: nodes.map((n) => n.id) } }), 'Permanently deleted');
  }
  async function emptyTrash() {
    if (!await confirmDialog({ title: 'Empty Trash?', body: 'Every item in Trash will be permanently erased and its space released. This cannot be undone.', confirmLabel: 'Empty Trash', danger: true })) return;
    guard(async () => { for (let i = 0; i < 400; i++) { const r = await api('/api/files/empty-trash', { method: 'POST', body: {} }); if (!r.remaining) break; } }, 'Trash emptied');
  }
  function menuFor(node, x, y, returnFocus) {
    const items = trashView
      ? [['restore', 'Restore', () => restore(S.sel.size > 1 ? sel() : [node])], ['trash', 'Delete permanently', () => purge(S.sel.size > 1 ? sel() : [node]), true]]
      : [['folder', 'Open', () => open(node)],
         ...(node.kind === 'file' ? [['download', 'Download', () => download(node).catch((e) => toast(e.message, 'err'))]] : []),
         ['edit', 'Rename', () => rename(node)], ['move', 'Move to…', () => move(S.sel.size > 1 ? sel() : [node])],
         ['star', node.favorite ? 'Remove favorite' : 'Add to favorites', () => fav(node)],
         ['trash', 'Move to Trash', () => trash(S.sel.size > 1 ? sel() : [node]), true]];
    openMenu(x, y, items, returnFocus);
  }
  ctx.fileActions = { newFolder };
  ctx.onLeave(() => { ctx.reload = null; });
  await load();
}
