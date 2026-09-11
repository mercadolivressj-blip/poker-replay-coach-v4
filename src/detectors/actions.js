import { luma, sat } from '../core/image.js';

function isButtonPixel(r, g, b) {
  const L = luma(r, g, b);
  const S = sat(r, g, b);
  const colored = S > 0.22 && L > 45;
  const gray = S < 0.18 && L > 52 && L < 205;
  return colored || gray;
}

function horizontalRuns(data, w, y0, y1, minCol = 0.34) {
  const bh = Math.max(1, y1 - y0 + 1);
  const col = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = y0; y <= y1; y++) {
      const i = (y * w + x) * 4;
      if (isButtonPixel(data[i], data[i + 1], data[i + 2])) n++;
    }
    col[x] = n / bh;
  }
  const runs = [];
  let s = -1;
  for (let x = 0; x <= w; x++) {
    const on = x < w && col[x] > minCol;
    if (on && s < 0) s = x;
    if (!on && s >= 0) {
      if (x - s > w * 0.07) runs.push([s, x - 1]);
      s = -1;
    }
  }
  const merged = [];
  for (const r of runs) {
    const p = merged[merged.length - 1];
    if (p && r[0] - p[1] < w * 0.018) p[1] = r[1];
    else merged.push([...r]);
  }
  return merged.filter(([a, b]) => b - a > w * 0.09 && b - a < w * 0.46);
}

export function detectActionRects(data, w, h) {
  if (!data || !w || !h) return [];
  const row = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isButtonPixel(data[i], data[i + 1], data[i + 2])) n++;
    }
    row[y] = n / w;
  }
  const bands = [];
  let s = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && row[y] > 0.18;
    if (on && s < 0) s = y;
    if (!on && s >= 0) {
      const bh = y - s;
      if (bh > h * 0.1) bands.push([s, y - 1]);
      s = -1;
    }
  }
  let best = null;
  for (const [y0, y1] of bands) {
    const bh = y1 - y0 + 1;
    const runs = horizontalRuns(data, w, y0, y1);
    if (runs.length < 2 || runs.length > 4) continue;
    const widths = runs.map(([a, b]) => b - a + 1);
    if (widths.filter((x) => x > w * 0.12).length < 2) continue;
    const yScore = (y0 + y1) / 2 / h;
    const countScore = runs.length === 3 ? 0.45 : runs.length === 2 ? 0.35 : 0;
    const heightScore = Math.min(0.35, bh / h);
    const score = yScore * 1.7 + countScore + heightScore;
    if (!best || score > best.score) best = { y0, y1, runs, score };
  }
  if (!best) return [];
  const rects = best.runs.slice(-3).map(([a, b]) => ({ x: a, y: best.y0, w: b - a + 1, h: best.y1 - best.y0 + 1 })).sort((a, b) => a.x - b.x);
  return rects.length >= 2 ? rects : [];
}

export function buttonColorFeatures(data, w, h, rect) {
  const x0 = Math.max(0, Math.floor(rect.x + rect.w * 0.12));
  const x1 = Math.min(w, Math.ceil(rect.x + rect.w * 0.88));
  const y0 = Math.max(0, Math.floor(rect.y + rect.h * 0.12));
  const y1 = Math.min(h, Math.ceil(rect.y + rect.h * 0.62));
  let R = 0, G = 0, B = 0, S = 0, L = 0, n = 0;
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = (y * w + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2], ll = luma(r, g, b);
    if (ll > 225 || ll < 28) continue;
    R += r; G += g; B += b; S += sat(r, g, b); L += ll; n++;
  }
  if (!n) return { r: 0, g: 0, b: 0, sat: 0, luma: 0 };
  return { r: R / n, g: G / n, b: B / n, sat: S / n, luma: L / n };
}

function twoButtonTypes(features, street = 'unknown') {
  const left = features[0] || { r: 0, g: 0, b: 0, sat: 0 };
  const blueCheck = left.b > left.r * 1.18 && left.b > left.g * 1.06 && left.sat > 0.28;
  const grayFold = left.sat < 0.24 || Math.max(left.r, left.g, left.b) - Math.min(left.r, left.g, left.b) < 28;
  if (blueCheck) return ['check', street === 'preflop' ? 'raise' : 'bet'];
  if (grayFold) return ['fold', 'call'];
  return ['fold', 'call'];
}

export function inferActions(rects, data = null, w = 0, h = 0, street = 'unknown') {
  if (rects.length < 2) return [];
  const sorted = [...rects].sort((a, b) => a.x - b.x);
  let types;
  if (sorted.length >= 3) types = ['fold', 'call', 'raise'];
  else if (data && w && h) types = twoButtonTypes(sorted.map((r) => buttonColorFeatures(data, w, h, r)), street);
  else types = ['fold', 'call'];
  return sorted.map((r, i) => ({ type: types[i] || 'unknown', amount: null, rect: r }));
}

export function amountCrop(canvas, rect) {
  const lowerY = rect.y + Math.round(rect.h * 0.52);
  const lowerH = Math.max(8, rect.y + rect.h - lowerY);
  const c = document.createElement('canvas');
  c.width = Math.max(120, rect.w * 5);
  c.height = Math.max(50, lowerH * 5);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, rect.x, lowerY, rect.w, lowerH, 0, 0, c.width, c.height);
  return c;
}
