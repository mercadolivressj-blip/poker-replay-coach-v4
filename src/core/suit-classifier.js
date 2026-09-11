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

const FACE_RANKS = new Set(['A','J','Q','K']);
const CORNER_PROFILE = Object.freeze({
  name: 'corner-under-rank', x0: 0.00, x1: 0.36, y0: 0.29, y1: 0.82, bonus: 0.16,
});
const NUMERIC_ROI_PROFILES = Object.freeze([
  CORNER_PROFILE,
  { name: 'right-top',   x0: 0.45, x1: 0.99, y0: 0.00, y1: 0.50, bonus: 0.08 },
  { name: 'right-lower', x0: 0.42, x1: 0.99, y0: 0.24, y1: 0.84, bonus: 0.05 },
  { name: 'mid-top',     x0: 0.25, x1: 0.76, y0: 0.00, y1: 0.52, bonus: 0.00 },
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

function mergeComponents(comps) {
  if (!comps.length) return null;
  const pts = comps.flatMap((c) => c.pts);
  let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
  for (const p of pts) {
    const c = comps.find((x) => x.pts.includes(p));
    if (!c) continue;
  }
  for (const c of comps) {
    minX = Math.min(minX, c.minX); maxX = Math.max(maxX, c.maxX);
    minY = Math.min(minY, c.minY); maxY = Math.max(maxY, c.maxY);
  }
  return { pts, area: pts.length, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function cornerComponent(raw, rw, rh) {
  const usable = raw.filter((c) => {
    if (c.area < 2 || c.w < 2 || c.h < 1) return false;
    if (c.minY <= Math.max(1, Math.floor(rh * 0.06))) return false; // rank tail/top-border fragment
    if (c.w > rw * 0.82 || c.h > rh * 0.90) return false;
    return true;
  });
  if (!usable.length) return null;
  const main = usable.reduce((a, b) => (a.area >= b.area ? a : b));
  const maxGap = Math.max(3, Math.round(rh * 0.18));
  const selected = usable.filter((c) => {
    if (c === main) return true;
    const horizontalNear = c.maxX >= main.minX - 3 && c.minX <= main.maxX + 3;
    const verticalGap = c.minY > main.maxY ? c.minY - main.maxY : main.minY > c.maxY ? main.minY - c.maxY : 0;
    return horizontalNear && verticalGap <= maxGap;
  });
  return mergeComponents(selected);
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
  return { mask: out, family: redRatio >= 0.28 ? 'red' : 'black', redRatio, quality, roi: profile.name };
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

  const raw = connected(ink, rw, rh);
  let component = null;
  if (profile.name === 'corner-under-rank') {
    component = cornerComponent(raw, rw, rh);
  } else {
    const comps = raw.filter((c) => {
      if (c.area < 5 || c.w < 3 || c.h < 3) return false;
      if (c.w > rw * 0.86 || c.h > rh * 0.92) return false;
      if (c.minX === 0 && c.w <= 2) return false;
      if (c.minY === 0 && c.h <= 2) return false;
      return true;
    });
    if (comps.length) {
      comps.sort((a, b) => {
        const score = (c) => {
          const shape = Math.min(1.35, c.area / Math.max(1, c.w * c.h * 0.42));
          const aspect = Math.min(c.w, c.h) / Math.max(1, Math.max(c.w, c.h));
          return c.area * shape * (0.72 + aspect * 0.28);
        };
        return score(b) - score(a);
      });
      component = comps[0];
    }
  }
  if (!component) return null;
  return normalizeComponent(component, redInk, rw, outW, outH, profile);
}

function extractSuitCandidates(data, w, h, outW = SUIT_MASK_W, outH = SUIT_MASK_H, rank = null) {
  const box = cardFaceBox(data, w, h);
  if (!box) return [];
  const r = rank ? String(rank).toUpperCase() : null;
  const profiles = FACE_RANKS.has(r) ? [CORNER_PROFILE] : NUMERIC_ROI_PROFILES;
  return profiles.map((profile) => extractFromProfile(data, w, h, box, profile, outW, outH)).filter(Boolean);
}

export function extractSuitMask(data, w, h, outW = SUIT_MASK_W, outH = SUIT_MASK_H, rank = null) {
  const candidates = extractSuitCandidates(data, w, h, outW, outH, rank);
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

export function classifySuitPixels(data, w, h, rank = null) {
  const extracted = extractSuitCandidates(data, w, h, SUIT_MASK_W, SUIT_MASK_H, rank);
  if (!extracted.length) return { suit: null, confidence: 0, distance: 1, margin: 0, family: null, mask: null, redRatio: 0, roi: null, voteCount: 0 };
  const results = extracted.map((candidate) => ({
    ...classifySuitMask(candidate.mask, candidate.family),
    mask: candidate.mask,
    redRatio: candidate.redRatio,
    roi: candidate.roi,
    quality: candidate.quality,
  }));

  const accepted = results.filter((r) => r.suit);
  const votes = new Map();
  for (const r of accepted) {
    const v = votes.get(r.suit) || { suit: r.suit, count: 0, score: 0, best: r };
    v.count++;
    v.score += r.confidence * (0.75 + r.quality * 0.25);
    if (r.confidence > v.best.confidence) v.best = r;
    votes.set(r.suit, v);
  }
  const rankedVotes = [...votes.values()].sort((a,b) => b.score - a.score || b.count - a.count);
  if (rankedVotes.length) {
    const winner = rankedVotes[0], runner = rankedVotes[1];
    const dominant = !runner || winner.score >= runner.score * 1.22;
    const face = FACE_RANKS.has(rank ? String(rank).toUpperCase() : null);
    const singleStrong = winner.count === 1 && winner.best.confidence >= (face ? 0.84 : 0.88) && winner.best.margin >= (face ? 0.035 : 0.045);
    if (dominant && (winner.count >= 2 || singleStrong)) {
      const confidence = Math.min(0.995, Math.max(winner.best.confidence, face ? 0.84 : 0.80 + Math.min(0.15, (winner.count - 1) * 0.055)));
      return { ...winner.best, suit: winner.suit, confidence, voteCount: winner.count, voteScore: winner.score, rankAware: !!rank };
    }
  }

  results.sort((a, b) => (b.confidence + b.quality * 0.08) - (a.confidence + a.quality * 0.08));
  const best = results[0];
  return { ...best, suit: null, confidence: Math.min(best.confidence, 0.68), ambiguous: true, voteCount: rankedVotes[0]?.count || 0, rankAware: !!rank };
}
