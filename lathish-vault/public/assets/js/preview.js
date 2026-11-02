import { api } from './lib/api.js';
import { h, fill } from './lib/dom.js';

const TEXT_LIMIT = 256 * 1024;

export function download(node) {
  return api('/api/downloads/url', { query: { id: node.id } }).then((r) => {
    const a = h('a', { href: r.url, rel: 'noopener noreferrer' }); document.body.append(a); a.click(); a.remove();
  });
}

/** Renders a safe preview. Content is shown only via <img>, a sandbox-free B2 PDF frame, or textContent: never as HTML. */
export async function renderPreview(box, node) {
  box.replaceChildren(h('p', { class: 'muted' }, h('span', { class: 'spinner' }), ' Loading preview…'));
  try {
    const r = await api('/api/downloads/url', { query: { id: node.id, disposition: 'inline' } });
    if (!r.previewKind) { box.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'No preview for this file type.'), h('button', { class: 'btn', type: 'button', onclick: () => download(node) }, 'Download')); return; }
    if (r.previewKind === 'image') box.replaceChildren(h('img', { src: r.url, alt: node.name, referrerPolicy: 'no-referrer', loading: 'lazy' }));
    else if (r.previewKind === 'pdf') box.replaceChildren(h('iframe', { src: r.url, title: `Preview of ${node.name}`, referrerPolicy: 'no-referrer' }));
    else {
      const res = await fetch(r.url, { headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` }, referrerPolicy: 'no-referrer', credentials: 'omit' });
      if (!res.ok && res.status !== 206) throw new Error('fetch failed');
      const reader = res.body.getReader(); const dec = new TextDecoder('utf-8'); let text = ''; let bytes = 0; let cut = false;
      for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; text += dec.decode(value, { stream: true }); if (bytes >= TEXT_LIMIT) { cut = true; reader.cancel(); break; } }
      fill(box, h('pre', {}, text), cut ? h('p', { class: 'muted' }, 'Preview truncated. Download for the full file.') : null);
    }
  } catch (e) {
    box.replaceChildren(h('p', { class: 'msg err', role: 'alert' }, e.status === 404 ? 'File not available.' : 'Preview unavailable. You can still download the file.'),
      h('button', { class: 'btn', type: 'button', onclick: () => download(node).catch(() => {}) }, 'Download'));
  }
}
