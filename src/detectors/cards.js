import { luma, sat, glyphVector } from '../core/image.js';

function isCardMaterial(r, g, b) { return luma(r, g, b) > 145 && sat(r, g, b) < 0.55; }
export function cardPresenceScore(data, w, h) {
  if (!data || !w || !h) return 0;
  let white = 0, bright = 0, edge = 0, edgeN = 0;
  for (let y = 0; y < h; y++) {
    let prev = null;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2], L = luma(r, g, b);
      if (isCardMaterial(r, g, b)) white++;
      if (L > 170) bright++;
      if (prev !== null) { edge += Math.abs(L - prev); edgeN++; }
      prev = L;
    }
  }
  const n = Math.max(1, w * h), whiteFrac = white / n, brightFrac = bright / n, edgeMean = edge / Math.max(1, edgeN);
  return Math.min(1, whiteFrac * 1.05 + brightFrac * 0.25 + Math.min(0.18, edgeMean / 120));
}
export function isCardPresent(data, w, h, threshold = 0.28) { return cardPresenceScore(data, w, h) >= threshold; }
export function boardCountFromScores(scores, threshold = 0.28) {
  const p = scores.map((s) => s >= threshold);
  if (!p.some(Boolean)) return 0;
  if (p[0] && p[1] && p[2] && p[3] && p[4]) return 5;
  if (p[0] && p[1] && p[2] && p[3] && !p[4]) return 4;
  if (p[0] && p[1] && p[2] && !p[3] && !p[4]) return 3;
  return 0;
}
function whiteMask(data, w, h) {
  const m = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) m[p] = isCardMaterial(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
  return m;
}
function runs(mask, w, h, minFill = 0.16) {
  const cols = [];
  for (let x = 0; x < w; x++) { let n = 0; for (let y = 0; y < h; y++) n += mask[y * w + x]; cols.push(n / h); }
  const out = []; let s = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && cols[x] >= minFill;
    if (on && s < 0) s = x;
    if (!on && s >= 0) { if (x - s >= 4) out.push([s, x - 1]); s = -1; }
  }
  return out;
}
export function detectCards(data, w, h, { max = 8, minH = 0.18, minFill = 0.16 } = {}) {
  const mask = whiteMask(data, w, h), out = [];
  for (const [s, e] of runs(mask, w, h, minFill)) {
    const rw = e - s + 1; let top = -1, bot = -1;
    for (let y = 0; y < h; y++) { let n = 0; for (let x = s; x <= e; x++) n += mask[y * w + x]; if (n / rw > 0.26) { if (top < 0) top = y; bot = y; } }
    if (top < 0) continue;
    const rh = bot - top + 1; if (rh < h * minH) continue;
    const expected = Math.max(8, rh * 0.72), count = Math.max(1, Math.round(rw / expected)), step = rw / count;
    for (let i = 0; i < count; i++) { const x = Math.round(s + i * step), cw = Math.round(step); if (cw / rh < 0.3 || cw / rh > 1.15) continue; out.push({ x, y: top, w: cw, h: rh }); }
  }
  return out.slice(0, max);
}
const similar = (a, b, tol) => Math.abs(a - b) / Math.max(1, Math.max(a, b)) <= tol;
export function selectHeroPair(rects, w, h) {
  const c = rects.filter((r) => r.y + r.h / 2 > h * 0.2).sort((a, b) => a.x - b.x); let best = null;
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
    const a = c[i], b = c[j]; if (!similar(a.h, b.h, 0.28) || !similar(a.w, b.w, 0.42)) continue;
    const v = Math.max(a.y, b.y), bottom = Math.min(a.y + a.h, b.y + b.h), overlap = Math.max(0, bottom - v) / Math.min(a.h, b.h);
    if (overlap < 0.72) continue;
    const gap = b.x - (a.x + a.w); if (gap > Math.max(a.w, b.w) * 0.55 || gap < -Math.max(a.w, b.w) * 0.2) continue;
    const center = (a.x + b.x + b.w) / 2, avgH = (a.h + b.h) / 2, sizePenalty = Math.abs(a.w - b.w) / Math.max(a.w, b.w);
    const score = (1 - Math.abs(center / w - 0.5)) * 2.2 + avgH / h - Math.max(0, gap) / w - sizePenalty * 0.7;
    if (!best || score > best.score) best = { pair: [a, b], score };
  }
  return best?.pair || null;
}
export function selectBoard(rects, w, h) {
  const c = rects.filter((r) => r.y / h < 0.82).sort((a, b) => a.x - b.x); let best = [];
  for (let i = 0; i < c.length; i++) {
    const run = [c[i]];
    for (let j = i + 1; j < c.length; j++) {
      const p = run[run.length - 1], r = c[j];
      const overlap = Math.max(0, Math.min(p.y + p.h, r.y + r.h) - Math.max(p.y, r.y)) / Math.min(p.h, r.h), gap = r.x - (p.x + p.w);
      if (overlap > 0.58 && gap < Math.max(p.w, r.w) * 1.05 && Math.abs(p.h - r.h) / Math.max(p.h, r.h) < 0.42) run.push(r);
      else if (gap > Math.max(p.w, r.w) * 1.35) break;
    }
    if (run.length > best.length) best = run;
  }
  return best.length >= 3 ? best.slice(0, 5) : [];
}
export function pairFingerprint(data, w, h, pair) { if (!pair) return null; return [...glyphVector(data, w, h, pair[0]), ...glyphVector(data, w, h, pair[1])]; }
export function slotFingerprint(slotCrops) {
  if (!slotCrops?.length) return null; const out = [];
  for (const crop of slotCrops) out.push(...glyphVector(crop.data, crop.w, crop.h, { x: 0, y: 0, w: crop.w, h: crop.h }));
  return out;
}
export function rankCrop(canvas, rect = null) {
  const src = rect ?? { x: 0, y: 0, w: canvas.width, h: canvas.height }, sw = Math.max(8, Math.round(src.w * 0.55)), sh = Math.max(10, Math.round(src.h * 0.45));
  const c = document.createElement('canvas'); c.width = Math.max(80, sw * 8); c.height = Math.max(90, sh * 8);
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, src.x, src.y, sw, sh, 0, 0, c.width, c.height); return c;
}
