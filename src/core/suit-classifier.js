import { luma, sat } from './image.js';
import { cardFaceBox, shiftedMaskDistance, unpackMask } from './rank-mask.js';

export const SUIT_MASK_W = 24;
export const SUIT_MASK_H = 24;

const TEMPLATE_B64 = Object.freeze({
  spades: 'AAAAAAAAAAQAAAQAAB8AwH8AwH8A4P8B4P8B4P8D+P8D+P8D+P8P+P8P+P8P+P8D+P8D4OQB4OQBAAQAAB8AAB8AAAAAAAAA',
  hearts: 'AAAAAAAAwIcPwIcP8P8/8P8//P8//P8//P8/8P8/8P8/8P8/8P8/wP8PwP8PgP8DgP8DgP8BAH4AAH4AABgAABgAAAAAAAAA',
  clubs: 'AAAAAAAAAAQAAAQAAB8AwB8AwB8AAB8AAB8AABwA+P8D+P8D+P8P+P8P+P8P+OQD+OQDAAQAAAQAAAQAAB8AAB8AAAAAAAAA',
  diamonds: 'AAAAAAAAAB8AAB8AAB8AwH8AwH8A4H8A4H8A4P8D+P8P+P8P+P8D+P8D4P8DwH8AwH8AwH8AwH8AAB8AAAcAAAcAAAAAAAAA',
});

// PokerStars compact hole cards place the rank at the far left and repeat the
// suit glyph to its right. Prefer the right-most glyph so the rank can never win
// the connected-component search; fall back to the first suit when clipped.
const ROI_PROFILES = Object.freeze([
  { name: 'right-suit', x0: 0.47, x1: 0.98, y0: 0.00, y1: 0.47, bonus: 0.08 },
  { name: 'mid-suit', x0: 0.27, x1: 0.74, y0: 0.00, y1: 0.47, bonus: 0.00 },
]);

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

function normalizeComponent(c, redInk, rw, outW, outH, profile) {
  const glyph = new Uint8Array(c.w * c.h); let redCount = 0;
  for (const p of c.pts) {
    const x = p % rw, y = Math.floor(p / rw);
    glyph[(y - c.minY) * c.w + (x - c.minX)] = 1;
    if (redInk[p]) redCount++;
  }
  const scale = Math.min((outW - 4) / c.w, (outH - 4) / c.h);
  const nw = Math.max(1, Math.round(c.w * scale)), nh = Math.max(1, Math.round(c.h * scale));
  const ox = Math.floor((outW - nw) / 2), oy = Math.floor((outH - nh) / 2); const out = new Uint8Array(outW * outH);
  for (let dy = 0; dy < nh; dy++) {
    const sy = Math.min(c.h - 1, Math.floor((dy + 0.5) / scale));
    for (let dx = 0; dx < nw; dx++) {
      const sx = Math.min(c.w - 1, Math.floor((dx + 0.5) / scale));
      if (glyph[sy * c.w + sx]) out[(oy + dy) * outW + (ox + dx)] = 1;
    }
  }
  const redRatio = redCount / Math.max(1, c.area);
  const compactness = Math.min(1, c.area / Math.max(1, c.w * c.h * 0.42));
  const quality = Math.min(1, 0.58 + compactness * 0.28 + (profile.bonus || 0));
  return {
    mask: out,
    family: redRatio >= 0.28 ? 'red' : 'black',
    redRatio,
    quality,
    roi: profile.name,
    bounds: { x: c.minX, y: c.minY, w: c.w, h: c.h },
  };
}

function extractFromProfile(data, w, h, box, profile, outW, outH) {
  const x0 = Math.max(0, Math.round(box.x + box.w * profile.x0));
  const x1 = Math.min(w, Math.round(box.x + box.w * profile.x1));
  const y0 = Math.max(0, Math.round(box.y + box.h * profile.y0));
  const y1 = Math.min(h, Math.round(box.y + box.h * profile.y1));
  const rw = x1 - x0, rh = y1 - y0;
  if (rw < 5 || rh < 5) return null;

  const ink = new Uint8Array(rw * rh); const redInk = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const i = ((y0 + y) * w + (x0 + x)) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const L = luma(r, g, b), S = sat(r, g, b);
    const red = r > 88 && r > g * 1.13 && r > b * 1.06 && S > 0.11;
    const dark = L < 150 && S < 0.72;
    if (red || dark) ink[y * rw + x] = 1;
    if (red) redInk[y * rw + x] = 1;
  }

  const comps = connected(ink, rw, rh).filter((c) => {
    if (c.area < 5 || c.w < 3 || c.h < 3) return false;
    if (c.w > rw * 0.86 || c.h > rh * 0.92) return false;
    if (c.minX === 0 && c.w <= 2) return false;
    if (c.minY === 0 && c.h <= 2) return false;
    return true;
  });
  if (!comps.length) return null;

  comps.sort((a, b) => {
    const score = (c) => {
      const cx = (c.minX + c.maxX + 1) / 2 / rw;
      const cy = (c.minY + c.maxY + 1) / 2 / rh;
      const center = Math.max(0.2, 1 - Math.abs(cx - 0.52) * 0.75 - Math.abs(cy - 0.38) * 0.35);
      const shape = Math.min(1.35, c.area / Math.max(1, c.w * c.h * 0.42));
      return c.area * center * shape;
    };
    return score(b) - score(a);
  });
  return normalizeComponent(comps[0], redInk, rw, outW, outH, profile);
}

function extractSuitCandidates(data, w, h, outW = SUIT_MASK_W, outH = SUIT_MASK_H) {
  const box = cardFaceBox(data, w, h);
  if (!box) return [];
  return ROI_PROFILES.map((profile) => extractFromProfile(data, w, h, box, profile, outW, outH)).filter(Boolean);
}

export function extractSuitMask(data, w, h, outW = SUIT_MASK_W, outH = SUIT_MASK_H) {
  const candidates = extractSuitCandidates(data, w, h, outW, outH);
  if (!candidates.length) return { mask: null, family: null, redRatio: 0, quality: 0, roi: null };
  candidates.sort((a, b) => b.quality - a.quality);
  return candidates[0];
}

export function classifySuitMask(mask, family = null) {
  if (!mask) return { suit: null, confidence: 0, distance: 1, margin: 0, family };
  const allowed = family === 'red' ? ['hearts', 'diamonds'] : family === 'black' ? ['spades', 'clubs'] : ['spades', 'hearts', 'clubs', 'diamonds'];
  const db = templates();
  const scores = allowed.map((suit) => ({ suit, d: shiftedMaskDistance(mask, db[suit], SUIT_MASK_W, SUIT_MASK_H, 2) })).sort((a, b) => a.d - b.d);
  const best = scores[0], second = scores[1] || { d: 1 }; const margin = Math.max(0, second.d - best.d);
  const accepted = best.d <= 0.50 && margin >= 0.025;
  const confidence = accepted
    ? Math.max(0.76, Math.min(0.99, 0.76 + (0.50 - best.d) * 0.40 + Math.min(0.14, margin) * 0.85))
    : Math.max(0, Math.min(0.70, (0.50 - best.d) * 0.65 + margin));
  return { suit: accepted ? best.suit : null, candidate: best.suit, confidence, distance: best.d, margin, family };
}

export function classifySuitPixels(data, w, h) {
  const extracted = extractSuitCandidates(data, w, h);
  if (!extracted.length) return { suit: null, confidence: 0, distance: 1, margin: 0, family: null, mask: null, redRatio: 0, roi: null };
  const results = extracted.map((candidate) => ({
    ...classifySuitMask(candidate.mask, candidate.family),
    mask: candidate.mask,
    redRatio: candidate.redRatio,
    roi: candidate.roi,
    quality: candidate.quality,
  })).sort((a, b) => {
    const aa = a.suit ? 1 : 0, bb = b.suit ? 1 : 0;
    return bb - aa || (b.confidence + b.quality * 0.08) - (a.confidence + a.quality * 0.08);
  });
  const best = results[0];
  const conflicting = results.slice(1).find((r) => r.suit && best.suit && r.suit !== best.suit && Math.abs(r.confidence - best.confidence) < 0.055);
  if (conflicting) return { ...best, suit: null, confidence: Math.min(best.confidence, 0.62), ambiguous: true };
  return best;
}
