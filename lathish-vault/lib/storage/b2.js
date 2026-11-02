import { PRESIGN_GET_TTL_S, PRESIGN_PART_TTL_S, PRESIGN_PUT_TTL_S } from '../constants.js';

/** Backblaze B2 via the S3-compatible API. The SDK is loaded lazily so unit tests need no install. */
export function createStorage(cfg, loader = async () => ({
  s3: await import('@aws-sdk/client-s3'), presign: await import('@aws-sdk/s3-request-presigner'),
})) {
  let ctx;
  const load = async () => {
    if (ctx) return ctx;
    const { s3, presign } = await loader();
    ctx = { s3, getSignedUrl: presign.getSignedUrl, client: new s3.S3Client({
      region: cfg.b2Region, endpoint: cfg.b2Endpoint,
      credentials: { accessKeyId: cfg.b2KeyId, secretAccessKey: cfg.b2AppKey },
    }) };
    return ctx;
  };
  const Bucket = cfg.b2Bucket;
  const missing = (e) => e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
  const noUpload = (e) => e?.name === 'NoSuchUpload' || e?.$metadata?.httpStatusCode === 404;

  return {
    async presignPut({ key, contentType }) {
      const { s3, client, getSignedUrl } = await load();
      return getSignedUrl(client, new s3.PutObjectCommand({ Bucket, Key: key, ContentType: contentType }),
        { expiresIn: PRESIGN_PUT_TTL_S, signableHeaders: new Set(['content-type']) });
    },
    async presignGet({ key, contentType, disposition }) {
      const { s3, client, getSignedUrl } = await load();
      return getSignedUrl(client, new s3.GetObjectCommand({
        Bucket, Key: key, ResponseContentType: contentType, ResponseContentDisposition: disposition,
      }), { expiresIn: PRESIGN_GET_TTL_S });
    },
    async presignPart({ key, uploadId, partNumber }) {
      const { s3, client, getSignedUrl } = await load();
      return getSignedUrl(client, new s3.UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: PRESIGN_PART_TTL_S });
    },
    async head(key) {
      const { s3, client } = await load();
      try {
        const r = await client.send(new s3.HeadObjectCommand({ Bucket, Key: key }));
        return { size: Number(r.ContentLength), etag: r.ETag };
      } catch (e) { if (missing(e)) return null; throw e; }
    },
    async createMultipart({ key, contentType }) {
      const { s3, client } = await load();
      const r = await client.send(new s3.CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }));
      return r.UploadId;
    },
    /** Returns null if the multipart upload no longer exists (already completed or aborted). */
    async listParts({ key, uploadId }) {
      const { s3, client } = await load();
      const parts = []; let marker;
      try {
        for (let i = 0; i < 20; i++) {
          const r = await client.send(new s3.ListPartsCommand({ Bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker, MaxParts: 1000 }));
          for (const p of r.Parts || []) parts.push({ partNumber: p.PartNumber, size: Number(p.Size), etag: p.ETag });
          if (!r.IsTruncated) break;
          marker = r.NextPartNumberMarker;
        }
      } catch (e) { if (noUpload(e)) return null; throw e; }
      return parts;
    },
    async completeMultipart({ key, uploadId, parts }) {
      const { s3, client } = await load();
      await client.send(new s3.CompleteMultipartUploadCommand({
        Bucket, Key: key, UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }));
    },
    async abortMultipart({ key, uploadId }) {
      const { s3, client } = await load();
      try { await client.send(new s3.AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId })); }
      catch (e) { if (!noUpload(e)) throw e; }
    },
    async deleteObject(key) {
      const { s3, client } = await load();
      await client.send(new s3.DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
