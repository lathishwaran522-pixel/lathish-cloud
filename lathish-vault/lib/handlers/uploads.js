import { ApiError } from '../http.js';
import { MAX_PART_URLS_PER_CALL, MULTIPART_SESSION_TTL_S, MULTIPART_THRESHOLD, PART_SIZE, SINGLE_SESSION_TTL_S } from '../constants.js';
import { rateLimit } from '../security/session.js';
import { assertAllowedExtension, contentTypeFor, optUuid, parseSize, sanitizeName, uuid } from '../validation/index.js';

/** Remove whatever the storage side holds for a released session. Best effort; failures are logged and swept by cron. */
async function cleanObject(deps, r) {
  try {
    if (r.multipart && r.uploadId) await deps.storage.abortMultipart({ key: r.objectKey, uploadId: r.uploadId });
    await deps.storage.deleteObject(r.objectKey);
  } catch (e) { deps.log('warn', 'object_cleanup_failed', { message: e.message }); }
}
export async function abortAndClean(deps, owner, sessionId, status = 'aborted') {
  const r = await deps.db.rpc('abort_upload', { p_owner: owner, p_session: sessionId, p_status: status });
  if (r.released) await cleanObject(deps, r);
  return r;
}
export async function cleanupExpired(deps) {
  const list = await deps.db.rpc('expire_sessions', { p_limit: 200 });
  for (const r of list) await cleanObject(deps, r);
  return list.length;
}

export async function init({ body, deps, user }) {
  const { db, storage, cfg } = deps;
  const parentId = optUuid(body.parentId, 'parentId');
  const name = sanitizeName(body.name);
  const size = parseSize(body.size);
  assertAllowedExtension(name, cfg.blockedExtensions);
  await rateLimit(deps, 'upload-init', 60, 240);

  const multipart = size > MULTIPART_THRESHOLD;
  const contentType = contentTypeFor(name);
  const key = `objects/${deps.randomUUID()}`;
  const args = { p_owner: user.id, p_parent: parentId, p_name: name, p_size: size, p_content_type: contentType, p_key: key,
    p_multipart: multipart, p_part_size: multipart ? PART_SIZE : null, p_part_count: multipart ? Math.ceil(size / PART_SIZE) : null,
    p_ttl_seconds: multipart ? MULTIPART_SESSION_TTL_S : SINGLE_SESSION_TTL_S };

  let reserved;
  try { reserved = await db.rpc('reserve_upload', args); }
  catch (e) {
    if (e.message !== 'quota_exceeded') throw e;
    await cleanupExpired(deps).catch(() => {}); // abandoned reservations may be what is blocking us
    reserved = await db.rpc('reserve_upload', args);
  }

  let uploadId = null;
  try {
    if (multipart) {
      uploadId = await storage.createMultipart({ key, contentType });
      await db.rpc('set_upload_id', { p_owner: user.id, p_session: reserved.sessionId, p_upload_id: uploadId });
    }
    const url = multipart ? null : await storage.presignPut({ key, contentType });
    return { status: 201, body: { sessionId: reserved.sessionId, nodeId: reserved.nodeId, name: reserved.name, size, contentType,
      multipart, partSize: multipart ? PART_SIZE : null, partCount: multipart ? args.p_part_count : null,
      url, expiresAt: reserved.expiresAt } };
  } catch (e) {
    deps.log('error', 'upload_init_failed', { message: e.message });
    await abortAndClean(deps, user.id, reserved.sessionId, 'aborted').catch(() => {});
    if (uploadId) await storage.abortMultipart({ key, uploadId }).catch(() => {});
    throw new ApiError(502, 'storage_unavailable', 'Storage service unavailable');
  }
}

async function openSession(deps, owner, id) {
  const s = await deps.db.rpc('get_upload_session', { p_owner: owner, p_session: uuid(id, 'sessionId') });
  return s;
}

export async function partUrls({ body, deps, user }) {
  const s = await openSession(deps, user.id, body.sessionId);
  if (s.status !== 'open' || !s.multipart || !s.uploadId) throw new ApiError(409, 'session_invalid', 'Upload session is not open');
  if (s.expired) { await abortAndClean(deps, user.id, s.id, 'expired'); throw new ApiError(410, 'session_expired', 'Upload session expired'); }
  const nums = body.parts;
  if (!Array.isArray(nums) || !nums.length || nums.length > MAX_PART_URLS_PER_CALL) throw new ApiError(400, 'invalid_request', 'parts must be a short array');
  for (const n of nums) if (!Number.isInteger(n) || n < 1 || n > s.partCount) throw new ApiError(400, 'invalid_part', 'Invalid part number');
  const unique = [...new Set(nums)];
  const urls = await Promise.all(unique.map(async (partNumber) => ({
    partNumber,
    size: partNumber < s.partCount ? s.partSize : s.size - (s.partCount - 1) * s.partSize,
    url: await deps.storage.presignPart({ key: s.objectKey, uploadId: s.uploadId, partNumber }),
  })));
  return { body: { parts: urls } };
}

function validateParts(s, parts) {
  const byNum = new Map(parts.map((p) => [p.partNumber, p]));
  const missing = [];
  for (let n = 1; n <= s.partCount; n++) {
    const p = byNum.get(n);
    const want = n < s.partCount ? s.partSize : s.size - (s.partCount - 1) * s.partSize;
    if (!p || p.size !== want) missing.push(n);
  }
  return { missing, extra: parts.some((p) => p.partNumber < 1 || p.partNumber > s.partCount) };
}

export async function complete({ body, deps, user }) {
  const { db, storage } = deps;
  const s = await openSession(deps, user.id, body.sessionId);
  if (s.status === 'committed') return { body: { node: await db.rpc('get_node', { p_owner: user.id, p_id: s.nodeId }) } }; // idempotent retry
  if (s.status !== 'open') throw new ApiError(409, 'session_closed', 'Upload session is closed');
  if (s.expired) { await abortAndClean(deps, user.id, s.id, 'expired'); throw new ApiError(410, 'session_expired', 'Upload session expired'); }

  if (s.multipart) {
    if (!s.uploadId) throw new ApiError(409, 'session_invalid', 'Upload session is not ready');
    const parts = await storage.listParts({ key: s.objectKey, uploadId: s.uploadId });
    if (parts) { // null => already completed by an earlier attempt; fall through to verification
      const v = validateParts(s, parts);
      if (v.missing.length || v.extra) throw new ApiError(409, 'parts_incomplete', 'Some parts are missing or have the wrong size', { missing: v.missing });
      await storage.completeMultipart({ key: s.objectKey, uploadId: s.uploadId, parts: parts.sort((a, b) => a.partNumber - b.partNumber) });
    }
  }

  const head = await storage.head(s.objectKey);
  if (!head) throw new ApiError(409, 'object_missing', 'The file has not been uploaded yet');
  if (head.size !== s.size) {
    await abortAndClean(deps, user.id, s.id, 'aborted');
    throw new ApiError(422, 'size_mismatch', 'Uploaded file size did not match; upload discarded');
  }
  try {
    const node = await db.rpc('commit_upload', { p_owner: user.id, p_session: s.id, p_actual_size: head.size });
    return { body: { node } };
  } catch (e) {
    if (['session_invalid', 'not_found', 'size_mismatch'].includes(e.message)) await storage.deleteObject(s.objectKey).catch(() => {});
    throw e;
  }
}

export async function abort({ body, deps, user }) {
  const id = uuid(body.sessionId, 'sessionId');
  const r = await abortAndClean(deps, user.id, id, 'aborted');
  return { body: { released: r.released } };
}
