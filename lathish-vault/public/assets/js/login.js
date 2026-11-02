import { api } from './lib/api.js';
import { startBackground, startTicker, addFloaters } from './lib/market.js';

const $ = (id) => document.getElementById(id);
startBackground($('bg')); startTicker($('ticker')); addFloaters($('floaters'));

const forms = { login: $('login-form'), reset: $('reset-form'), newpw: $('newpw-form') };
const show = (name) => { for (const [k, f] of Object.entries(forms)) f.hidden = k !== name; forms[name].querySelector('input')?.focus(); };
const say = (el, text, cls = 'err') => { el.textContent = text; el.className = `msg ${cls}`; };

if (new URLSearchParams(location.search).has('expired')) say($('login-msg'), 'Your session expired. Please sign in again.', 'err');

// Recovery link from the verified e-mail: Supabase puts the short-lived token in the URL hash.
const hash = new URLSearchParams(location.hash.slice(1));
let recoveryToken = null;
if (hash.get('type') === 'recovery' && hash.get('access_token')) {
  recoveryToken = hash.get('access_token');
  history.replaceState(null, '', location.pathname); // remove the token from the address bar immediately
  show('newpw');
} else if (hash.get('error_description')) {
  say($('login-msg'), 'That reset link is invalid or has expired.');
  history.replaceState(null, '', location.pathname);
} else {
  api('/api/auth/session').then(() => location.replace('/dashboard.html#/dashboard')).catch(() => {});
}

let busy = false;
const guard = (btn, fn) => async (e) => {
  e.preventDefault(); if (busy) return; busy = true; btn.disabled = true;
  try { await fn(); } finally { busy = false; btn.disabled = false; }
};

forms.login.addEventListener('submit', guard($('login-btn'), async () => {
  const email = $('email').value.trim(); const password = $('password').value;
  if (!email || !password) return say($('login-msg'), 'Enter your email and password.');
  say($('login-msg'), 'Signing in…', 'ok');
  try { await api('/api/auth/login', { method: 'POST', body: { email, password } }); $('password').value = ''; location.replace('/dashboard.html#/dashboard'); }
  catch (e) { say($('login-msg'), e.status === 429 ? 'Too many attempts. Please wait a few minutes.' : e.status === 401 ? 'Invalid email or password.' : e.message); }
}));
forms.reset.addEventListener('submit', guard($('reset-btn'), async () => {
  try { await api('/api/auth/reset', { method: 'POST', body: { email: $('reset-email').value.trim() } }); say($('reset-msg'), 'If that address is the owner’s, a reset link is on its way.', 'ok'); }
  catch (e) { say($('reset-msg'), e.message); }
}));
forms.newpw.addEventListener('submit', guard($('newpw-btn'), async () => {
  const a = $('newpw').value; const b = $('newpw2').value;
  if (a.length < 12) return say($('newpw-msg'), 'Use at least 12 characters.');
  if (a !== b) return say($('newpw-msg'), 'Passwords do not match.');
  try { await api('/api/auth/reset/complete', { method: 'POST', body: { accessToken: recoveryToken, password: a } }); recoveryToken = null; show('login'); say($('login-msg'), 'Password updated. Please sign in.', 'ok'); }
  catch (e) { say($('newpw-msg'), e.message); }
}));
$('forgot').addEventListener('click', () => show('reset'));
$('back').addEventListener('click', () => show('login'));
