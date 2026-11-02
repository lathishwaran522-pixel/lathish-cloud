import { api } from './lib/api.js';

const FILE_PARALLEL = 3; const PART_PARALLEL = 3; const PART_ATTEMPTS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Browser -> B2 PUT with real byte progress. Never buffers the file: XHR streams the Blob/slice. */
function put(url, blob, contentType, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    const onAbort = () => x.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    x.open('PUT', url);
    if (contentType) x.setRequestHeader('Content-Type', contentType);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    x.onload = () => { signal.removeEventListener('abort', onAbort); (x.status >= 200 && x.status < 300) ? resolve() : reject(Object.assign(new Error(`Storage rejected the upload (${x.status})`), { status: x.status })); };
    x.onerror = () => { signal.removeEventListener('abort', onAbort); reject(Object.assign(new Error('Network error during upload'), { network: true })); };
    x.onabort = () => reject(Object.assign(new Error('Canceled'), { name: 'AbortError' }));
    x.send(blob);
  });
}

export class UploadQueue extends EventTarget {
  constructor() { super(); this.items = []; this.seq = 0; this.running = 0; }
  get active() { return this.items.some((i) => ['queued', 'uploading'].includes(i.status)); }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  add(files, parentId) {
    for (const file of files) {
      const it = { id: ++this.seq, file, parentId, name: file.name, size: file.size, status: 'queued', loaded: 0, error: null, sessionId: null, abort: null };
      if (!file.size) { it.status = 'error'; it.error = 'Empty files cannot be uploaded'; }
      this.items.push(it);
    }
    this.emit('change'); this.pump();
  }
  pump() {
    while (this.running < FILE_PARALLEL) { const it = this.items.find((i) => i.status === 'queued'); if (!it) break; this.run(it); }
  }
  async run(it) {
    this.running++; it.status = 'uploading'; it.error = null; it.loaded = 0; it.abort = new AbortController(); this.emit('change');
    try { await this.transfer(it); it.status = 'done'; it.loaded = it.size; this.emit('done', it); }
    catch (e) {
      it.status = it.abort.signal.aborted ? 'canceled' : 'error'; it.error = it.status === 'error' ? (e.message || 'Upload failed') : null;
      // Failed or canceled: release the server-side reservation (and any multipart upload) right away.
      if (it.sessionId) api('/api/uploads/abort', { method: 'POST', body: { sessionId: it.sessionId } }).catch(() => {});
      this.emit('failed', it);
    } finally { it.sessionId = it.status === 'done' ? it.sessionId : null; this.running--; this.emit('change'); this.pump(); }
  }
  async transfer(it) {
    const { signal } = it.abort;
    const init = await api('/api/uploads/init', { method: 'POST', signal, body: { parentId: it.parentId, name: it.file.name, size: it.file.size } });
    it.sessionId = init.sessionId; it.name = init.name;
    if (!init.multipart) await put(init.url, it.file, init.contentType, (n) => { it.loaded = n; this.emit('change'); }, signal);
    else await this.multipart(it, init, signal);
    await api('/api/uploads/complete', { method: 'POST', signal, body: { sessionId: init.sessionId } });
  }
  async multipart(it, init, signal) {
    const { partCount, partSize } = init; const loaded = new Array(partCount + 1).fill(0); const urls = new Map(); let next = 1;
    const report = () => { it.loaded = loaded.reduce((a, b) => a + b, 0); this.emit('change'); };
    const fetchUrls = async (from) => {
      const want = []; for (let n = from; n <= partCount && want.length < 6; n++) if (!urls.has(n)) want.push(n);
      const r = await api('/api/uploads/part-urls', { method: 'POST', signal, body: { sessionId: init.sessionId, parts: want } });
      for (const p of r.parts) urls.set(p.partNumber, p.url);
    };
    const worker = async () => {
      while (next <= partCount) {
        const n = next++;
        const blob = it.file.slice((n - 1) * partSize, Math.min(n * partSize, it.size));
        for (let attempt = 1; ; attempt++) {
          try {
            if (!urls.has(n)) await fetchUrls(n);
            await put(urls.get(n), blob, null, (b) => { loaded[n] = b; report(); }, signal);
            loaded[n] = blob.size; report(); break;
          } catch (e) {
            if (signal.aborted || attempt >= PART_ATTEMPTS) throw e;
            if (e.status === 403) urls.delete(n); // expired/invalid signature: ask for a fresh URL
            loaded[n] = 0; await sleep(800 * 2 ** (attempt - 1));
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PART_PARALLEL, partCount) }, worker));
  }
  cancel(id) { const it = this.items.find((i) => i.id === id); if (!it) return; if (it.status === 'queued') { it.status = 'canceled'; this.emit('change'); } else it.abort?.abort(); }
  retry(id) { const it = this.items.find((i) => i.id === id); if (it && ['error', 'canceled'].includes(it.status) && it.size) { it.status = 'queued'; this.emit('change'); this.pump(); } }
  clearFinished() { this.items = this.items.filter((i) => ['queued', 'uploading'].includes(i.status)); this.emit('change'); }
}
