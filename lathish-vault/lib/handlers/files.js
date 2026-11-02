import { ApiError } from '../http.js';
import { PAGE_SIZE } from '../constants.js';
import { deleteMany } from '../storage/delete.js';
import { optUuid, parseListQuery, sanitizeName, uuid } from '../validation/index.js';

export async function list({ query, deps, user }) {
  const q = parseListQuery(query);
  const r = await deps.db.rpc('list_nodes', { p_owner: user.id, p_view: q.view, p_parent: q.parent, p_q: q.q, p_sort: q.sort,
    p_dir: q.dir, p_folders_only: q.foldersOnly, p_limit: q.limit || PAGE_SIZE, p_offset: q.offset });
  const crumbs = q.view === 'folder' && q.parent ? await deps.db.rpc('breadcrumbs', { p_owner: user.id, p_id: q.parent }) : [];
  if (q.view === 'folder' && q.parent && !crumbs.length) throw new ApiError(404, 'not_found', 'Folder not found');
  return { body: { ...r, breadcrumbs: crumbs } };
}

export async function get({ query, deps, user }) {
  const id = uuid(query.id);
  const node = await deps.db.rpc('get_node', { p_owner: user.id, p_id: id });
  delete node.objectKey; // storage keys never leave the server
  return { body: { node, breadcrumbs: node.parentId ? await deps.db.rpc('breadcrumbs', { p_owner: user.id, p_id: node.parentId }) : [] } };
}

export async function createFolder({ body, deps, user }) {
  const node = await deps.db.rpc('create_folder', { p_owner: user.id, p_parent: optUuid(body.parentId, 'parentId'),
    p_name: sanitizeName(body.name, { strict: true }) });
  return { status: 201, body: { node } };
}
export async function rename({ body, deps, user }) {
  return { body: { node: await deps.db.rpc('rename_node', { p_owner: user.id, p_id: uuid(body.id), p_name: sanitizeName(body.name, { strict: true }) }) } };
}
export async function move({ body, deps, user }) {
  return { body: { node: await deps.db.rpc('move_node', { p_owner: user.id, p_id: uuid(body.id), p_parent: optUuid(body.parentId, 'parentId') }) } };
}
export async function favorite({ body, deps, user }) {
  return { body: { node: await deps.db.rpc('set_favorite', { p_owner: user.id, p_id: uuid(body.id), p_value: body.value === true }) } };
}

const ids = (body) => {
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 50) throw new ApiError(400, 'invalid_request', 'ids must be 1-50 UUIDs');
  return [...new Set(body.ids.map((i) => uuid(i)))];
};
export async function trash({ body, deps, user }) {
  for (const id of ids(body)) await deps.db.rpc('trash_node', { p_owner: user.id, p_id: id });
  return { body: { ok: true } };
}
export async function restore({ body, deps, user }) {
  const out = [];
  for (const id of ids(body)) out.push(await deps.db.rpc('restore_node', { p_owner: user.id, p_id: id }));
  return { body: { nodes: out } };
}

/** Delete objects from B2 FIRST; metadata and quota are released only if every object deletion succeeded. */
async function purgeIds(deps, owner, idList) {
  const targets = await deps.db.rpc('purge_targets', { p_owner: owner, p_ids: idList });
  const failed = await deleteMany(deps.storage, targets.map((t) => t.objectKey));
  if (failed) throw new ApiError(502, 'storage_unavailable', `Could not delete ${failed} stored object(s); nothing was removed. Try again.`);
  return deps.db.rpc('purge_commit', { p_owner: owner, p_ids: idList });
}
export async function purge({ body, deps, user }) {
  return { body: await purgeIds(deps, user.id, ids(body)) };
}
/** Processes up to 25 trashed roots per call; the client repeats until `remaining` is 0. */
export async function emptyTrash({ deps, user }) {
  const roots = await deps.db.rpc('trash_roots', { p_owner: user.id, p_limit: 25 });
  if (roots.length) await purgeIds(deps, user.id, roots);
  const more = await deps.db.rpc('trash_roots', { p_owner: user.id, p_limit: 1 });
  return { body: { purgedRoots: roots.length, remaining: more.length } };
}
