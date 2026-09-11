export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
export function sat(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx ? (mx - mn) / mx : 0;
}

/** Crop normalized source geometry, optionally into a reusable scratch canvas. */
export function cropCanvas(source, rect, targetW = null, targetCanvas = null) {
  const sx = Math.round(rect.x * source.width);
  const sy = Math.round(rect.y * source.height);
  const sw = Math.max(2, Math.round(rect.w * source.width));
  const sh = Math.max(2, Math.round(rect.h * source.height));
  const scale = targetW ? Math.min(1, targetW / sw) : 1;
  const c = targetCanvas || document.createElement('canvas');
  c.width = Math.max(2, Math.round(sw * scale));
  c.height = Math.max(2, Math.round(sh * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return { canvas: c, ctx, data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

/** Freeze a scratch crop before handing it to asynchronous OCR/AI. */
export function cloneCrop(crop) {
  const c = document.createElement('canvas');
  c.width = crop.w;
  c.height = crop.h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(crop.canvas, 0, 0);
  return { canvas: c, ctx, data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

export function rectToNorm(r, w, h) {
  return { x: r.x / w, y: r.y / h, w: r.w / w, h: r.h / h };
}
export function meanAbsDiff(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** Rank/suit glyph signature from the top-left of a physical card slot. */
export function glyphVector(data, w, h, rect, binsX = 10, binsY = 12) {
  const gx = rect.x;
  const gy = rect.y;
  const gw = Math.max(4, Math.round(rect.w * 0.46));
  const gh = Math.max(4, Math.round(rect.h * 0.44));
  const out = [];
  for (let by = 0; by < binsY; by++) {
    for (let bx = 0; bx < binsX; bx++) {
      let ink = 0;
      let n = 0;
      const x0 = Math.max(0, Math.floor(gx + (gw * bx) / binsX));
      const x1 = Math.min(w, Math.ceil(gx + (gw * (bx + 1)) / binsX));
      const y0 = Math.max(0, Math.floor(gy + (gh * by) / binsY));
      const y1 = Math.min(h, Math.ceil(gy + (gh * (by + 1)) / binsY));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const L = luma(data[i], data[i + 1], data[i + 2]);
          if (L < 155) ink++;
          n++;
        }
      }
      out.push(n ? ink / n : 0);
    }
  }
  return out;
}

export function vectorDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let active = 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > 0.02 || b[i] > 0.02) active++;
    s += Math.abs(a[i] - b[i]);
  }
  return s / Math.max(active, Math.ceil(a.length * 0.25));
}

/** Max per-card glyph distance so a one-card change cannot be diluted by the unchanged card. */
export function pairVectorDistance(a,b){
  if(!a||!b||a.length!==b.length||a.length<2)return 1;
  const half=Math.floor(a.length/2);
  return Math.max(vectorDistance(a.slice(0,half),b.slice(0,half)),vectorDistance(a.slice(half),b.slice(half)));
}
