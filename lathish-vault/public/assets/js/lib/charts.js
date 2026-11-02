const C = { green: '#2dffa1', cyan: '#2bd9ff', violet: '#9b72ff', red: '#ff5271', amber: '#ffc857', grid: 'rgba(255,255,255,.07)', text: '#9b98b3' };
export const PALETTE = [C.cyan, C.violet, C.green, C.amber, C.red, '#6b7280'];

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 300; const hgt = canvas.clientHeight || 160;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hgt);
  return { g, w, h: hgt };
}

/** points: [{label, value}] */
export function lineChart(canvas, points, { fmt = String, max } = {}) {
  const { g, w, h } = setup(canvas); const pad = { l: 8, r: 8, t: 10, b: 20 };
  const top = Math.max(max ?? 0, ...points.map((p) => p.value), 1);
  g.strokeStyle = C.grid; g.lineWidth = 1;
  for (let i = 0; i <= 3; i++) { const y = pad.t + ((h - pad.t - pad.b) * i) / 3; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke(); }
  if (points.length < 2) { g.fillStyle = C.text; g.font = '12px ui-monospace, monospace'; g.fillText('Not enough history yet', pad.l + 4, h / 2); return; }
  const xy = points.map((p, i) => [pad.l + ((w - pad.l - pad.r) * i) / (points.length - 1), h - pad.b - ((h - pad.t - pad.b) * p.value) / top]);
  const grad = g.createLinearGradient(0, pad.t, 0, h - pad.b); grad.addColorStop(0, 'rgba(45,255,161,.28)'); grad.addColorStop(1, 'rgba(45,255,161,0)');
  g.beginPath(); xy.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.lineTo(xy.at(-1)[0], h - pad.b); g.lineTo(xy[0][0], h - pad.b); g.fillStyle = grad; g.fill();
  g.beginPath(); xy.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.strokeStyle = C.green; g.lineWidth = 2; g.shadowColor = C.green; g.shadowBlur = 8; g.stroke(); g.shadowBlur = 0;
  g.fillStyle = C.text; g.font = '11px ui-monospace, monospace';
  g.fillText(points[0].label, pad.l, h - 5); const last = points.at(-1).label; g.fillText(last, w - pad.r - g.measureText(last).width, h - 5);
  g.fillStyle = C.green; g.fillText(fmt(points.at(-1).value), w - pad.r - g.measureText(fmt(points.at(-1).value)).width, Math.max(12, xy.at(-1)[1] - 6));
}

export function barChart(canvas, points) {
  const { g, w, h } = setup(canvas); const pad = { l: 8, r: 8, t: 14, b: 20 };
  const top = Math.max(...points.map((p) => p.value), 1); const bw = (w - pad.l - pad.r) / Math.max(points.length, 1);
  g.font = '11px ui-monospace, monospace';
  if (!points.length) { g.fillStyle = C.text; g.fillText('No uploads in the last 14 days', pad.l + 4, h / 2); return; }
  points.forEach((p, i) => {
    const bh = ((h - pad.t - pad.b) * p.value) / top; const x = pad.l + i * bw + bw * 0.15;
    g.fillStyle = C.violet; g.shadowColor = C.violet; g.shadowBlur = 6; g.fillRect(x, h - pad.b - bh, bw * 0.7, bh); g.shadowBlur = 0;
    g.fillStyle = C.text; if (points.length <= 8 || i % 2 === 0) g.fillText(p.label, x, h - 5);
  });
}

export function donut(canvas, segs) {
  const { g, w, h } = setup(canvas); const cx = w / 2; const cy = h / 2; const r = Math.min(w, h) / 2 - 8;
  const total = segs.reduce((s, x) => s + x.value, 0);
  if (!total) { g.strokeStyle = C.grid; g.lineWidth = 16; g.beginPath(); g.arc(cx, cy, r - 8, 0, Math.PI * 2); g.stroke(); return; }
  let a = -Math.PI / 2;
  segs.forEach((s, i) => { const d = (s.value / total) * Math.PI * 2; g.beginPath(); g.arc(cx, cy, r - 8, a, a + d); g.strokeStyle = PALETTE[i % PALETTE.length]; g.lineWidth = 16; g.stroke(); a += d; });
}
