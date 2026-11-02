// Reports (and with --delete removes) B2 objects with no metadata row, and stale multipart uploads. Objects/uploads younger than 48h are ignored.
import { S3Client, ListObjectsV2Command, DeleteObjectCommand, ListMultipartUploadsCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { loadDotEnv } from './env-file.mjs';
import { loadConfig } from '../lib/config.js';
loadDotEnv();
const cfg = loadConfig(process.env); const del = process.argv.includes('--delete'); const cutoff = Date.now() - 48 * 3600 * 1000;
const s3 = new S3Client({ region: cfg.b2Region, endpoint: cfg.b2Endpoint, credentials: { accessKeyId: cfg.b2KeyId, secretAccessKey: cfg.b2AppKey } });
const known = new Set();
for (let from = 0; ; from += 1000) {
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/nodes?select=object_key&object_key=not.is.null`, { headers: { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
  if (!r.ok) { console.error('Could not read metadata:', r.status); process.exit(1); }
  const rows = await r.json(); rows.forEach((x) => known.add(x.object_key)); if (rows.length < 1000) break;
}
let token; let orphans = 0;
do {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: cfg.b2Bucket, Prefix: 'objects/', ContinuationToken: token }));
  for (const o of r.Contents || []) if (!known.has(o.Key) && o.LastModified.getTime() < cutoff) {
    orphans++; console.log(`${del ? 'deleting' : 'orphan'}: ${o.Key} (${o.Size} bytes)`);
    if (del) await s3.send(new DeleteObjectCommand({ Bucket: cfg.b2Bucket, Key: o.Key }));
  }
  token = r.NextContinuationToken;
} while (token);
const mp = await s3.send(new ListMultipartUploadsCommand({ Bucket: cfg.b2Bucket, Prefix: 'objects/' }));
for (const u of mp.Uploads || []) if (u.Initiated.getTime() < cutoff) {
  console.log(`${del ? 'aborting' : 'stale multipart'}: ${u.Key}`); orphans++;
  if (del) await s3.send(new AbortMultipartUploadCommand({ Bucket: cfg.b2Bucket, Key: u.Key, UploadId: u.UploadId }));
}
console.log(orphans ? `${orphans} item(s) found${del ? ' and removed' : '. Re-run with --delete to remove them.'}` : 'No orphans found.');
