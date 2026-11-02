import { $, h, icon } from './lib/dom.js';

let off = null;
export function closeMenu() { const m = $('#ctx'); if (!m) return; m.hidden = true; m.replaceChildren(); off?.(); off = null; }

/** items: [iconName, label, handler, danger?] */
export function openMenu(x, y, items, returnFocus) {
  const m = $('#ctx'); closeMenu();
  m.replaceChildren(...items.map(([ic, label, fn, danger]) =>
    h('button', { class: `menu-item${danger ? ' danger' : ''}`, type: 'button', role: 'menuitem', onclick: () => { closeMenu(); fn(); } }, icon(ic, 'sm'), label)));
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`; m.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  m.querySelector('button')?.focus();
  const onKey = (e) => {
    const b = [...m.querySelectorAll('button')]; const i = b.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); returnFocus?.focus?.(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); b[(i + 1) % b.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); b[(i - 1 + b.length) % b.length].focus(); }
    else if (e.key === 'Tab') closeMenu();
  };
  const onDown = (e) => { if (!m.contains(e.target)) closeMenu(); };
  document.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDown); window.addEventListener('scroll', closeMenu, true);
  off = () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); window.removeEventListener('scroll', closeMenu, true); };
}
