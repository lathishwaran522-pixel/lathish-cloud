import { api } from './lib/api.js';
import { startBackground } from './lib/market.js';
startBackground(document.getElementById('bg'));
api('/api/auth/session').then(() => location.replace('/dashboard.html#/dashboard')).catch(() => location.replace('/login.html'));
