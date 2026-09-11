import { luma, sat } from './image.js';
import { cardFaceBox, shiftedMaskDistance, unpackMask } from './rank-mask.js';

export const SUIT_MASK_W = 24;
export const SUIT_MASK_H = 24;

const TEMPLATE_B64 = Object.freeze({
  spades: 'AAAAAAAAAAQAAAQAAB8AwH8AwH8A4P8B4P8B4P8D+P8D+P8D+P8P+P8P+P8P+P8D+P8D4OQB4OQBAAQAAB8AAB8AAAAAAAAA',
  hearts: 'AAAAAAAAgIcPwIcP8P8/8P8//P8//P8//P8/8P8/8P8/8P8/8P8/wP8PwP8PgP8DgP8DgP8BAH4AAH4AABgAABgAAAAAAAAA',
  clubs: 'AAAAAAAAAAQAAAQAAB8AwB8AwB8AAB8AAB8AABwA+P8D+P8D+P8P+P8P+P8P+OQD+OQDAAQAAAQAAAQAAB8AAB8AAAAAAAAA',
  diamonds: 'AAAAAAAAAB8AAB8AAB8AwH8AwH8A4H8A4H8A4P8D+P8P+P8P+P8D+P8D4P8DwH8AwH8AwH8AwH8AAB8AAAcAAAcAAAAAAAAA',
});

let decoded = null;
function decodeBase64(s) {
  if (typeof atob === 'function') {
    const raw = atob(s); const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(s, 'base64'));
}
function templates() {
  if (decoded) return decoded;
  decoded = Object.fromEntries(Object.entries(TEMPLATE_B64).map(([suit, b64]) => [suit, unpackMask(decodeBase64(b64), SUIT_MASK_W * SUIT_MASK_H)]));
  return decoded;
}

function connected(mask, w, h) {
  const seen = new Uint8Array(w * h); const out = []; const stack = [];
  for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
    const start = sy * w + sx; if (!mask[start] || seen[start]) continue;
    stack.length = 0; stack.push(start); seen[start] = 1;
    const pts = []; let minX = sx, maxX = sx, minY = sy, maxY = sy;
    while (stack.length) {
      const p = stack.pop(); const x = p % w, y = Math.floor(p / w); pts.push(p);
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx; if (!mask[ni] || seen[ni]) continue; seen[ni] = 1; stack.push(ni);
      }
    }
    out.push({ pts, area: pts.length, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return out;
}

export function extractSuitMask(data, w, h, outW = SUIT_MASK_W, outH = SUIT_MASK_H) {
  const box = cardFaceBox(data, w, h); if (!box) return { mask: null, family: null, redRatio: 0 };
  const x0 = Math.max(0, Math.round(box.x + box.w * 0.20));
  const x1 = Math.min(w, Math.round(box.x + box.w * 0.58));
  const y0 = Math.max(0, Math.round(box.y + box.h * 0.02));
  const y1 = Math.min(h, Math.round(box.y + box.h * 0.56));
  const rw = x1 - x0, rh = y1 - y0; if (rw < 4 || rh < 4) return { mask: null, family: null, redRatio: 0 };

  const ink = new Uint8Array(rw * rh); const redInk = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = ((y0 + y) * w + (x0 + x)) * 4; const r = data[i], g = data[i + 1], b = data[i + 2];
    const L = luma(r, g, b), S = sat(r, g, b);
    const red = r > 95 && r > g * 1.16 && r > b * 1.08 && S > 0.14;
    const dark = L < 145 && S < 0.68;
    if (red || dark) ink[y * rw + x] = 1; if (red) redInk[y * rw + x] = 1;
  }

  const comps = connected(ink, rw, rh).filter((c) => {
    if (c.area < 5 || c.w < 3 || c.h < 3) return false;
    if (c.minX === 0 && c.w <= 3) return false;
    if (c.minY === 0 && c.h <= 2) return false;
    if (c.w > rw * 0.8 && c.h <= 2) return false;
    return true;
  });
  if (!comps.length) return { mask: null, family: null, redRatio: 0 };
  comps.sort((a, b) => (b.area * (b.minX < rw * 0.65 ? 1.4 : 1) * (b.minY < rh * 0.65 ? 1.2 : 1)) - (a.area * (a.minX < rw * 0.65 ? 1.4 : 1) * (a.minY < rh * 0.65 ? 1.2 : 1)));
  const c = comps[0];

  const glyph = new Uint8Array(c.w * c.h); let redCount = 0;
  for (const p of c.pts) {
    const x = p % rw, y = Math.floor(p / rw); glyph[(y - c.minY) * c.w + (x - c.minX)] = 1; if (redInk[p]) redCount++;
  }
  const scale = Math.min((outW - 4) / c.w, (outH - 4) / c.h); const nw = Math.max(1, Math.round(c.w * scale)), nh = Math.max(1, Math.round(c.h * scale));
  const ox = Math.floor((outW - nw) / 2), oy = Math.floor((outH - nh) / 2); const out = new Uint8Array(outW * outH);
  for (let dy = 0; dy < nh; dy++) {
    const sy = Math.min(c.h - 1, Math.floor((dy + 0.5) / scale));
    for (let dx = 0; dx < nw; dx++) {
      const sx = Math.min(c.w - 1, Math.floor((dx + 0.5) / scale));
      if (glyph[sy * c.w + sx]) out[(oy + dy) * outW + (ox + dx)] = 1;
    }
  }
  const redRatio = redCount / Math.max(1, c.area); return { mask: out, family: redRatio >= 0.38 ? 'red' : 'black', redRatio };
}

export function classifySuitMask(mask, family = null) {
  if (!mask) return { suit: null, confidence: 0, distance: 1, margin: 0, family };
  const allowed = family === 'red' ? ['hearts', 'diamonds'] : family === 'black' ? ['spades', 'clubs'] : ['spades', 'hearts', 'clubs', 'diamonds'];
  const db = templates(); const scores = allowed.map((suit) => ({ suit, d: shiftedMaskDistance(mask, db[suit], SUIT_MASK_W, SUIT_MASK_H, 2) })).sort((a, b) => a.d - b.d);
  const best = scores[0], second = scores[1] || { d: 1 }; const margin = Math.max(0, second.d - best.d);
  const accepted = best.d <= 0.46 && margin >= 0.035;
  const confidence = accepted ? Math.max(0.74, Math.min(0.985, 0.74 + (0.46 - best.d) * 0.38 + Math.min(0.12, margin) * 0.9)) : Math.max(0, Math.min(0.68, (0.46 - best.d) * 0.7 + margin));
  return { suit: accepted ? best.suit : null, candidate: best.suit, confidence, distance: best.d, margin, family };
}

export function classifySuitPixels(data, w, h) {
  const extracted = extractSuitMask(data, w, h); return { ...classifySuitMask(extracted.mask, extracted.family), mask: extracted.mask, redRatio: extracted.redRatio };
}
