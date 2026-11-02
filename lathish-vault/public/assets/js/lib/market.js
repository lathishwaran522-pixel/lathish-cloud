// Decorative market visuals. ALL values are SIMULATED and never presented as live data.
const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function startBackground(canvas) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d'); let w = 0; let h = 0; let raf = 0; let timer = 0; let last = 0;
  const candles = []; let price = 100;
  const next = () => { const o = price; price = Math.max(20, price + (Math.random() - 0.48) * 6); const c = price;
    return { o, c, hi: Math.max(o, c) + Math.random() * 3, lo: Math.min(o, c) - Math.random() * 3 }; };
  for (let i = 0; i < 90; i++) candles.push(next());
  const resize = () => { const dpr = Math.min(window.devicePixelRatio || 1, 1.5); w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(0); };
  function draw(shift) {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const lo = Math.min(...candles.map((c) => c.lo)); const hi = Math.max(...candles.map((c) => c.hi));
    const cw = w / (candles.length - 1); const Y = (v) => h * 0.2 + (1 - (v - lo) / (hi - lo || 1)) * h * 0.6;
    candles.forEach((c, i) => {
      const x = i * cw - shift * cw; const up = c.c >= c.o; ctx.strokeStyle = ctx.fillStyle = up ? 'rgba(45,255,161,.55)' : 'rgba(255,82,113,.45)';
      ctx.beginPath(); ctx.moveTo(x, Y(c.hi)); ctx.lineTo(x, Y(c.lo)); ctx.stroke();
      ctx.fillRect(x - cw * 0.3, Math.min(Y(c.o), Y(c.c)), cw * 0.6, Math.max(1.5, Math.abs(Y(c.o) - Y(c.c))));
    });
    ctx.beginPath(); candles.forEach((c, i) => { const x = i * cw - shift * cw; i ? ctx.lineTo(x, Y(c.c)) : ctx.moveTo(x, Y(c.c)); });
    ctx.strokeStyle = 'rgba(43,217,255,.75)'; ctx.lineWidth = 1.6; ctx.shadowColor = '#2bd9ff'; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
  }
  let shift = 0;
  const frame = (t) => { raf = requestAnimationFrame(frame); if (document.hidden || t - last < 50) return; last = t; // ~20 fps cap
    shift += 0.004; if (shift >= 1) { shift = 0; candles.shift(); candles.push(next()); } draw(shift); };
  resize();
  const onResize = (() => { let id; return () => { clearTimeout(id); id = setTimeout(resize, 150); }; })();
  window.addEventListener('resize', onResize);
  if (!reduce()) raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); clearTimeout(timer); window.removeEventListener('resize', onResize); };
}

const SYMS = [['LVX-50', 4210.4], ['VAULT', 188.12], ['CLOUD', 96.4], ['BYTE', 312.75], ['NODE-X', 54.08], ['HASH', 1204.3],
  ['TERA', 77.9], ['GIGA', 23.46], ['ARCH', 640.2], ['SYNC', 15.31], ['ZIP', 8.77], ['CACHE', 402.5]];

export function startTicker(box) {
  if (!box) return () => {};
  const state = SYMS.map(([s, v]) => ({ s, v, d: 0 }));
  const make = () => {
    const track = document.createElement('div'); track.className = 'ticker-track'; track.setAttribute('aria-hidden', 'true');
    const cells = [];
    for (let rep = 0; rep < 2; rep++) for (const st of state) {
      const el = document.createElement('span'); el.className = 'tick';
      const a = document.createElement('b'); a.textContent = st.s; const b = document.createElement('span'); const c = document.createElement('span');
      el.append(a, b, c); track.append(el); cells.push({ st, b, c });
    }
    return { track, cells };
  };
  const { track, cells } = make();
  const tag = document.createElement('span'); tag.className = 'sim-tag'; tag.textContent = 'SIMULATED · NOT LIVE DATA';
  const sr = document.createElement('span'); sr.className = 'sr-only'; sr.textContent = 'Decorative simulated market ticker, not real financial data.';
  box.replaceChildren(track, tag, sr);
  const paint = () => cells.forEach(({ st, b, c }) => {
    b.textContent = st.v.toFixed(2); const up = st.d >= 0; c.className = up ? 'up' : 'down';
    c.textContent = `${up ? '▲' : '▼'} ${Math.abs(st.d).toFixed(2)}%`;
  });
  paint();
  if (reduce()) return () => {};
  const id = setInterval(() => { if (document.hidden) return; state.forEach((st) => { const ch = (Math.random() - 0.5) * 0.012; st.v *= 1 + ch; st.d = st.d * 0.9 + ch * 100; }); paint(); }, 2500);
  return () => clearInterval(id);
}

export function addFloaters(box) {
  if (!box || reduce()) return;
  const names = ['file', 'folder', 'image', 'pdf', 'archive', 'text', 'video', 'audio'];
  names.forEach((n, i) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', `floater f${i + 1}`); s.setAttribute('viewBox', '0 0 24 24');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', `/assets/icons/sprite.svg#i-${n}`); s.append(u); box.append(s);
  });
}
