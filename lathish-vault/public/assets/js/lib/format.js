// Decimal units: 1,000,000,000 bytes displays as "1 GB".
export function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1000) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB']; let i = 0; let v = n / 1000;
  const r = (x) => Number(x.toFixed(x < 10 ? 2 : 1));
  while (r(v) >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${r(v)} ${u[i]}`;
}
export const pct = (used, total) => (total ? Math.min(100, (used / total) * 100) : 0);
export function relTime(iso) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now'; if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`; if (s < 7 * 86400) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
export const fullDate = (iso) => new Date(iso).toLocaleString();
export function kindOf(node) {
  if (node.kind === 'folder') return 'folder';
  const m = node.mimeType || '';
  if (m.startsWith('image/')) return 'image'; if (m === 'application/pdf') return 'pdf'; if (m.startsWith('text/')) return 'text';
  if (m.startsWith('video/')) return 'video'; if (m.startsWith('audio/')) return 'audio'; if (m === 'application/zip') return 'archive';
  return 'file';
}
export function activityText(a) {
  const n = a.detail?.name ? ` “${a.detail.name}”` : '';
  switch (a.action) {
    case 'file.uploaded': return `File uploaded${n}`;
    case 'folder.created': return `Folder created${n}`;
    case 'node.renamed': return `Renamed “${a.detail?.from}” → “${a.detail?.to}”`;
    case 'node.moved': return `Moved${n}`;
    case 'node.trashed': return `Moved to Trash${n}`;
    case 'node.restored': return `Restored${n}`;
    case 'node.purged': return `Permanently deleted ${a.detail?.items ?? ''} item(s)`;
    default: return a.action;
  }
}
export function securityText(e) {
  return ({ 'auth.login': 'Signed in', 'auth.login_failed': 'Failed sign-in attempt', 'auth.reset_requested': 'Password reset requested',
    'auth.password_reset': 'Password reset completed', 'auth.password_changed': 'Password changed', 'auth.signout_others': 'Other sessions signed out',
    'file.download': `Downloaded “${e.detail?.name ?? ''}”`, 'storage.recomputed': 'Usage recomputed' })[e.action] || e.action;
}
