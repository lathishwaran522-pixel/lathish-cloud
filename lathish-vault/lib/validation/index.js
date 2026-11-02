import { ApiError } from '../http.js';
import { MAX_NAME_LENGTH, QUOTA_BYTES } from '../constants.js';

const bad = (msg, code = 'invalid_request') => new ApiError(400, code, msg);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNSAFE_SRC = '[\\\\/\\u0000-\\u001f\\u007f\\u202a-\\u202e\\u2066-\\u2069]'; // separators, control, bidi-override
const hasUnsafe = (s) => new RegExp(UNSAFE_SRC).test(s);
const replaceUnsafe = (s) => s.replace(new RegExp(UNSAFE_SRC, 'g'), '_');

export const isUuid = (v) => typeof v === 'string' && UUID.test(v);
export function uuid(v, field = 'id') { if (!isUuid(v)) throw bad(`${field} must be a UUID`); return v.toLowerCase(); }
export function optUuid(v, field) { return v === undefined || v === null || v === '' || v === 'root' ? null : uuid(v, field); }

/** strict=true rejects unsafe names (rename/create); strict=false sanitizes (upload filenames). */
export function sanitizeName(raw, { strict = false } = {}) {
  if (typeof raw !== 'string') throw bad('name must be a string');
  let s = raw.normalize('NFC');
  if (hasUnsafe(s)) { if (strict) throw bad('Name contains characters that are not allowed'); s = replaceUnsafe(s); }
  s = s.trim();
  if (!s || s === '.' || s === '..') { if (strict) throw bad('Name is required'); s = '_'; }
  if ([...s].length > MAX_NAME_LENGTH) {
    if (strict) throw bad(`Name must be at most ${MAX_NAME_LENGTH} characters`);
    const ext = extensionOf(s); const keep = MAX_NAME_LENGTH - (ext ? ext.length + 1 : 0);
    s = [...s].slice(0, keep).join('') + (ext ? `.${ext}` : '');
  }
  return s;
}

export function extensionOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}
export function assertAllowedExtension(name, blocked) {
  if (blocked.includes(extensionOf(name))) throw new ApiError(400, 'type_blocked', 'This file type is not allowed in the vault');
}

export function parseSize(v) {
  if (!Number.isSafeInteger(v) || v <= 0) throw bad('size must be a positive integer (bytes)');
  if (v > QUOTA_BYTES) throw new ApiError(413, 'quota_exceeded', 'File is larger than the 1 GB vault');
  return v;
}

const TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', svg: 'image/svg+xml', pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/plain', csv: 'text/plain', json: 'text/plain', log: 'text/plain', xml: 'text/plain',
  yml: 'text/plain', yaml: 'text/plain', ini: 'text/plain', js: 'text/plain', mjs: 'text/plain', ts: 'text/plain',
  css: 'text/plain', html: 'text/plain', htm: 'text/plain', py: 'text/plain', sh: 'text/plain', sql: 'text/plain',
  zip: 'application/zip', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
};
/** Content type is derived from the extension on the server; the browser-supplied type is ignored.
 *  Script-capable text formats (html, js, svg-as-document) are stored as text/plain or only embedded via <img>. */
export const contentTypeFor = (name) => TYPES[extensionOf(name)] || 'application/octet-stream';

export function previewKind(contentType) {
  if (/^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)$/.test(contentType)) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType === 'text/plain') return 'text';
  return null;
}

export function contentDisposition(kind, filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

const VIEWS = ['folder', 'recent', 'favorites', 'trash', 'search'];
const SORTS = ['name', 'size', 'type', 'modified'];
export function parseListQuery(q) {
  const view = q.view || 'folder';
  if (!VIEWS.includes(view)) throw bad('invalid view');
  const sort = q.sort || 'name'; const dir = q.dir || 'asc';
  if (!SORTS.includes(sort) || !['asc', 'desc'].includes(dir)) throw bad('invalid sort');
  const text = (q.q || '').trim().slice(0, 100);
  const limit = Math.min(Math.max(parseInt(q.limit ?? '100', 10) || 100, 1), 200);
  const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);
  return { view: text && view === 'folder' ? 'search' : view, parent: optUuid(q.parent, 'parent'),
           q: text, sort, dir, foldersOnly: q.folders === '1', limit, offset };
}

export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 12 || p.length > 128) throw bad('Password must be 12-128 characters', 'weak_password');
  return p;
}
