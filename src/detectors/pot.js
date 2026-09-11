import { luma } from '../core/image.js';

export function findPotPill(data, w, h) {
  if (!data || !w || !h) return null;
  const lum = new Uint8Array(w * h), hist = new Uint32Array(256);
  for (let p = 0, i = 0; p < lum.length; p++, i += 4) {
    const L = Math.max(0, Math.min(255, Math.round(luma(data[i], data[i + 1], data[i + 2])))); lum[p] = L; hist[L]++;
  }
  const quantile = (fraction) => { const target = Math.floor(lum.length * fraction); let seen = 0; for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen > target) return v; } return 255; };
  const median = quantile(0.5), q25 = quantile(0.25), darkCut = Math.max(18, Math.min(median - 7, q25 - 4));
  const mask = new Uint8Array(w * h); for (let p = 0; p < mask.length; p++) mask[p] = lum[p] < darkCut ? 1 : 0;
  const rowFill = new Float32Array(h);
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) n += mask[y * w + x]; rowFill[y] = n / Math.max(1, w); }
  const bands = []; let start = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && rowFill[y] > 0.12;
    if (on && start < 0) start = y;
    if ((!on || y === h) && start >= 0) { if (y - start >= Math.max(4, h * 0.08)) bands.push([start, y - 1]); start = -1; }
  }
  let best = null;
  for (const [y0, y1] of bands) {
    const bh = y1 - y0 + 1, colFill = new Float32Array(w);
    for (let x = 0; x < w; x++) { let n = 0; for (let y = y0; y <= y1; y++) n += mask[y * w + x]; colFill[x] = n / Math.max(1, bh); }
    const runs = []; let rs = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && colFill[x] > 0.14;
      if (on && rs < 0) rs = x;
      if ((!on || x === w) && rs >= 0) { if (x - rs >= 3) runs.push([rs, x - 1]); rs = -1; }
    }
    const merged = [], maxGap = w * 0.1;
    for (const run of runs) { const last = merged[merged.length - 1]; if (last && run[0] - last[1] - 1 <= maxGap) last[1] = run[1]; else merged.push([...run]); }
    for (const [x0, x1] of merged) {
      const rw = x1 - x0 + 1; if (rw < w * 0.18) continue;
      const aspect = rw / Math.max(1, bh); if (aspect < 1.8 || aspect > 16) continue;
      const cx = (x0 + x1) / 2 / w, cy = (y0 + y1) / 2 / h; if (Math.abs(cx - 0.5) > 0.34) continue;
      const score = (1 - Math.abs(cx - 0.5)) * 3 + (1 - Math.abs(cy - 0.58)) * 1.2 + Math.min(1, rw / w);
      if (!best || score > best.score) best = { x: x0, y: y0, w: rw, h: bh, score };
    }
  }
  if (!best) return null;
  const padX = Math.max(4, Math.round(w * 0.025)), padY = Math.max(2, Math.round(h * 0.025)), x = Math.max(0, best.x - padX), y = Math.max(0, best.y - padY);
  return { x, y, w: Math.min(w - x, best.w + padX * 2), h: Math.min(h - y, best.h + padY * 2) };
}
export function potCrop(canvas, rect = null) {
  const r = rect ?? { x: 0, y: 0, w: canvas.width, h: canvas.height }, c = document.createElement('canvas');
  c.width = Math.max(180, Math.round(r.w * 6)); c.height = Math.max(60, Math.round(r.h * 6));
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height); return c;
}
export class PotConsensus {
  constructor() { this.reset(); }
  reset() { this.value = null; this.pending = null; this.hits = 0; }
  observe(v) {
    if (!Number.isFinite(v) || v <= 1) return null;
    const n = Math.round(v); if (this.value !== null && n < this.value * 0.72) return null;
    if (this.pending !== null && Math.abs(this.pending - n) <= Math.max(2, n * 0.006)) this.hits++; else { this.pending = n; this.hits = 1; }
    if (this.hits < 2) return null; if (this.value !== null && n < this.value) return null; this.value = n; return n;
  }
}
