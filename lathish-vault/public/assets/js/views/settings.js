import { api } from '../lib/api.js';
import { h, icon } from '../lib/dom.js';
import { toast } from '../lib/ui.js';

export async function render(root, ctx) {
  ctx.currentFolderId = null;
  const me = await api('/api/auth/session').catch(() => null); if (!me) return;
  const name = h('input', { class: 'input', id: 'dn', value: me.displayName, maxlength: 60 }); const nameMsg = h('p', { class: 'msg', role: 'status' });
  const cur = h('input', { class: 'input', id: 'cur', type: 'password', autocomplete: 'current-password' }); const nw = h('input', { class: 'input', id: 'nw', type: 'password', autocomplete: 'new-password' });
  const nw2 = h('input', { class: 'input', id: 'nw2', type: 'password', autocomplete: 'new-password' }); const pwMsg = h('p', { class: 'msg', role: 'alert' });
  const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Save'); const pwBtn = h('button', { class: 'btn primary', type: 'submit' }, 'Change password');
  root.replaceChildren(h('div', { class: 'page-in' }, h('div', { class: 'page-head' }, h('h1', {}, 'Account Settings')),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card glass' }, h('h2', {}, 'Profile'), h('p', { class: 'muted' }, 'Signed in as ', h('span', { class: 'mono' }, me.email)),
        h('form', { onsubmit: async (e) => { e.preventDefault(); saveBtn.disabled = true; try { await api('/api/storage/profile', { method: 'POST', body: { displayName: name.value } }); nameMsg.className = 'msg ok'; nameMsg.textContent = 'Saved'; ctx.refreshSummary(); } catch (er) { nameMsg.className = 'msg err'; nameMsg.textContent = er.message; } saveBtn.disabled = false; } },
          h('div', { class: 'field' }, h('label', { for: 'dn' }, 'Display name'), name), nameMsg, saveBtn)),
      h('section', { class: 'card glass' }, h('h2', {}, 'Change password'),
        h('form', { onsubmit: async (e) => { e.preventDefault(); pwMsg.className = 'msg err';
            if (nw.value.length < 12) { pwMsg.textContent = 'Use at least 12 characters.'; return; } if (nw.value !== nw2.value) { pwMsg.textContent = 'Passwords do not match.'; return; }
            pwBtn.disabled = true; try { await api('/api/auth/change-password', { method: 'POST', body: { currentPassword: cur.value, newPassword: nw.value } }); cur.value = nw.value = nw2.value = ''; pwMsg.className = 'msg ok'; pwMsg.textContent = 'Password changed. Other sessions were signed out.'; } catch (er) { pwMsg.textContent = er.message; } pwBtn.disabled = false; } },
          h('div', { class: 'field' }, h('label', { for: 'cur' }, 'Current password'), cur), h('div', { class: 'field' }, h('label', { for: 'nw' }, 'New password (12+ characters)'), nw),
          h('div', { class: 'field' }, h('label', { for: 'nw2' }, 'Confirm new password'), nw2), pwMsg, pwBtn)),
      h('section', { class: 'card glass' }, h('h2', {}, 'Session'),
        h('button', { class: 'btn', type: 'button', onclick: () => ctx.logout() }, icon('logout', 'sm'), 'Sign out')))));
}
