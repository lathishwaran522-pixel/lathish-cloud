import { $, h, icon } from './dom.js';

export function toast(message, type = 'info') {
  const box = $('#toasts'); if (!box) return;
  const t = h('div', { class: `toast ${type}` }, icon(type === 'err' ? 'alert' : type === 'ok' ? 'check' : 'info'), h('span', {}, message));
  box.append(t); setTimeout(() => t.remove(), type === 'err' ? 7000 : 4000);
  while (box.children.length > 4) box.firstChild.remove();
}

function modal(build) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); prev?.focus?.(); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
      if (e.key === 'Tab') { // keep focus inside the dialog
        const f = [...back.querySelectorAll('button, input, [tabindex="0"]')].filter((x) => !x.disabled);
        if (!f.length) return; const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    const box = h('div', { class: 'modal glass', role: 'dialog', 'aria-modal': 'true' });
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) close(undefined); } }, box);
    build(box, close);
    document.body.append(back); document.addEventListener('keydown', onKey, true);
    (box.querySelector('input') || box.querySelector('.btn.primary, .btn'))?.focus();
  });
}

export const confirmDialog = ({ title, body, confirmLabel = 'Confirm', danger = false }) => modal((box, close) => {
  box.setAttribute('aria-label', title);
  box.append(h('h2', {}, title), h('p', { class: 'muted' }, body),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => close(true) }, confirmLabel)));
}).then((v) => v === true);

export const promptDialog = ({ title, label, value = '', confirmLabel = 'Save' }) => modal((box, close) => {
  box.setAttribute('aria-label', title);
  const input = h('input', { class: 'input', id: 'dlg-in', value, maxlength: 255, autocomplete: 'off' });
  const submit = () => { const v = input.value.trim(); if (v) close(v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  box.append(h('h2', {}, title), h('div', { class: 'field' }, h('label', { for: 'dlg-in' }, label), input),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close(undefined) }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'button', onclick: submit }, confirmLabel)));
  setTimeout(() => { input.focus(); input.select(); });
});

/** Folder picker: resolves to {id|null} or undefined if cancelled. */
export const pickFolder = (api, { exclude = [] } = {}) => modal((box, close) => {
  box.setAttribute('aria-label', 'Move to');
  let current = null; let trail = [];
  const list = h('ul', { class: 'picker' }); const where = h('p', { class: 'muted mono' });
  const load = async () => {
    list.replaceChildren(h('li', {}, h('span', { class: 'spinner' })));
    try {
      const r = await api('/api/files/list', { query: { view: 'folder', parent: current || 'root', folders: '1' } });
      list.replaceChildren();
      if (current) list.append(h('li', {}, h('button', { class: 'menu-item', type: 'button', onclick: () => { trail.pop(); current = trail.at(-1)?.id ?? null; load(); } }, icon('move'), '.. (up)')));
      for (const f of r.items.filter((i) => !exclude.includes(i.id)))
        list.append(h('li', {}, h('button', { class: 'menu-item', type: 'button', onclick: () => { trail.push(f); current = f.id; load(); } }, icon('folder'), f.name)));
      if (!r.items.length) list.append(h('li', { class: 'muted' }, 'No subfolders'));
      where.textContent = `/${trail.map((t) => t.name).join('/')}`;
    } catch (e) { list.replaceChildren(h('li', { class: 'msg err' }, e.message)); }
  };
  box.append(h('h2', {}, 'Move to…'), where, list,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close(undefined) }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => close({ id: current }) }, 'Move here')));
  load();
});
