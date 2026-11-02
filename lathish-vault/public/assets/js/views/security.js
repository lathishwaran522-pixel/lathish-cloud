import { api } from '../lib/api.js';
import { h, icon } from '../lib/dom.js';
import { relTime, securityText } from '../lib/format.js';
import { toast } from '../lib/ui.js';

export async function render(root, ctx) {
  ctx.currentFolderId = null;
  root.replaceChildren(h('div', { class: 'skeleton skeleton-row' }));
  let ev;
  try { ev = (await api('/api/storage/events', { query: { category: 'security' } })).events; }
  catch (e) { root.replaceChildren(h('div', { class: 'empty', role: 'alert' }, icon('alert'), h('p', {}, e.message), h('button', { class: 'btn', type: 'button', onclick: () => ctx.rerender() }, 'Retry'))); return; }
  const failed = ev.filter((e) => e.action === 'auth.login_failed').length;
  root.replaceChildren(h('div', { class: 'page-in' }, h('div', { class: 'page-head' }, h('h1', {}, 'Security')),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card glass' }, h('h2', {}, 'Protections in effect'),
        h('ul', { class: 'feed' }, ...['Private B2 bucket; files only via 2-minute presigned URLs', 'HttpOnly, SameSite=Strict session cookies (no tokens in JavaScript)', 'Server verifies the owner on every API request',
          'Strict Content-Security-Policy, no inline scripts or styles', 'Login and reset rate limiting with generic errors', 'Uploads verified against storage before they are committed'].map((t) => h('li', {}, icon('check', 'sm'), t))),
        h('p', { class: 'muted' }, 'No system is perfectly secure. Keep your password unique and your Supabase, Vercel and Backblaze accounts protected with 2FA.')),
      h('section', { class: 'card glass' }, h('h2', {}, 'Sessions'), h('p', { class: 'muted' }, 'Sign out every other browser or device that holds a session for this vault.'),
        h('button', { class: 'btn', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { await api('/api/auth/signout-others', { method: 'POST', body: {} }); toast('Other sessions signed out', 'ok'); } catch (er) { toast(er.message, 'err'); } e.currentTarget.disabled = false; } }, icon('logout', 'sm'), 'Sign out other sessions'),
        h('p', { class: failed ? 'msg err' : 'msg' }, failed ? `${failed} failed sign-in attempt(s) in the recent log.` : 'No failed sign-ins in the recent log.')),
      h('section', { class: 'card glass' }, h('h2', {}, 'Security log'),
        ev.length ? h('ul', { class: 'feed' }, ev.slice(0, 25).map((e) => h('li', {}, h('span', { class: e.action === 'auth.login_failed' ? 'down' : '' }, securityText(e)), h('time', {}, relTime(e.at))))) : h('p', { class: 'muted' }, 'No events yet.')))));
}
