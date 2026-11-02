/** Delete many objects with bounded concurrency. Returns the number of failures. Missing objects count as success. */
export async function deleteMany(storage, keys, concurrency = 8) {
  let failed = 0; let i = 0;
  const worker = async () => {
    while (i < keys.length) {
      const key = keys[i++];
      try { await storage.deleteObject(key); } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));
  return failed;
}
