// Decimal units everywhere: 1 GB = 1,000,000,000 bytes (must match the DB default).
export const QUOTA_BYTES = 1_000_000_000;
export const MiB = 1024 * 1024;
/** Files larger than this use multipart upload; smaller files use one presigned PUT. */
export const MULTIPART_THRESHOLD = 64 * MiB;
export const PART_SIZE = 32 * MiB; // B2 minimum part is 5 MiB; 1 GB / 32 MiB = ~30 parts (limit 10,000)
export const MAX_PARTS = 10_000;
export const SINGLE_SESSION_TTL_S = 60 * 60;
export const MULTIPART_SESSION_TTL_S = 24 * 60 * 60;
export const PRESIGN_PUT_TTL_S = 15 * 60;
export const PRESIGN_PART_TTL_S = 60 * 60;
export const PRESIGN_GET_TTL_S = 120;
export const MAX_PART_URLS_PER_CALL = 50;
export const MAX_NAME_LENGTH = 255;
export const PAGE_SIZE = 100;
