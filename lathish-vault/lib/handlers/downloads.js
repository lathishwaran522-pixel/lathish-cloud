import { ApiError } from '../http.js';
import { audit } from '../security/session.js';
import { contentDisposition, previewKind, uuid } from '../validation/index.js';

/** Short-lived presigned GET. Only ACTIVE files of the owner; trashed or pending files are refused. */
export async function url({ query, deps, user }) {
  const node = await deps.db.rpc('get_node', { p_owner: user.id, p_id: uuid(query.id) });
  if (node.kind !== 'file' || node.status !== 'active' || !node.objectKey) throw new ApiError(404, 'not_found', 'Not found');
  const inline = query.disposition === 'inline';
  const kind = previewKind(node.mimeType || '');
  const safeInline = inline && kind;
  const signed = await deps.storage.presignGet({
    key: node.objectKey,
    contentType: safeInline ? node.mimeType : 'application/octet-stream', // never let B2 serve user content as HTML/JS
    disposition: contentDisposition(safeInline ? 'inline' : 'attachment', node.name),
  });
  if (!safeInline) await audit(deps, 'security', 'file.download', node.id, { name: node.name });
  return { body: { url: signed, name: node.name, size: node.size, previewKind: kind, expiresInSeconds: 120 } };
}
