import * as auth from './handlers/auth.js';
import * as files from './handlers/files.js';
import * as uploads from './handlers/uploads.js';
import * as downloads from './handlers/downloads.js';
import * as storage from './handlers/storage.js';

// [method, path, handler, mode]  mode: 'public' | 'owner' | 'cron'
export const routes = [
  ['POST', '/api/auth/login', auth.login, 'public'],
  ['POST', '/api/auth/logout', auth.logout, 'public'],
  ['POST', '/api/auth/reset', auth.requestReset, 'public'],
  ['POST', '/api/auth/reset/complete', auth.completeReset, 'public'],
  ['GET', '/api/auth/session', auth.session, 'owner'],
  ['POST', '/api/auth/change-password', auth.changePassword, 'owner'],
  ['POST', '/api/auth/signout-others', auth.signOutOthers, 'owner'],

  ['GET', '/api/files/list', files.list, 'owner'],
  ['GET', '/api/files/get', files.get, 'owner'],
  ['POST', '/api/folders/create', files.createFolder, 'owner'],
  ['POST', '/api/files/rename', files.rename, 'owner'],
  ['POST', '/api/files/move', files.move, 'owner'],
  ['POST', '/api/files/favorite', files.favorite, 'owner'],
  ['POST', '/api/files/trash', files.trash, 'owner'],
  ['POST', '/api/files/restore', files.restore, 'owner'],
  ['POST', '/api/files/purge', files.purge, 'owner'],
  ['POST', '/api/files/empty-trash', files.emptyTrash, 'owner'],

  ['POST', '/api/uploads/init', uploads.init, 'owner'],
  ['POST', '/api/uploads/part-urls', uploads.partUrls, 'owner'],
  ['POST', '/api/uploads/complete', uploads.complete, 'owner'],
  ['POST', '/api/uploads/abort', uploads.abort, 'owner'],

  ['GET', '/api/downloads/url', downloads.url, 'owner'],

  ['GET', '/api/storage/summary', storage.summary, 'owner'],
  ['GET', '/api/storage/events', storage.events, 'owner'],
  ['POST', '/api/storage/profile', storage.setProfile, 'owner'],
  ['POST', '/api/storage/recompute', storage.recompute, 'owner'],
  ['GET', '/api/storage/cleanup', storage.cleanup, 'cron'],
];
