import { extractRankMask, shiftedMaskDistance, unpackMask, RANK_MASK_W, RANK_MASK_H } from './rank-mask.js';
import { SEEDED_RANK_TEMPLATES } from './rank-templates.js';

const RANKS = [...'23456789TJQKA'];
let decoded = null;

function decodeBase64(s) {
  if (typeof atob === 'function') {
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(s, 'base64'));
}

function inkCount(mask) {
  let n = 0;
  for (const v of mask) n += v ? 1 : 0;
  return n;
}

function seedDb() {
  if (decoded) return decoded;
  decoded = {};
  for (const rank of RANKS) {
    const masks = (SEEDED_RANK_TEMPLATES[rank] || [])
      .map((s) => unpackMask(decodeBase64(s), RANK_MASK_W * RANK_MASK_H))
      .filter((m) => inkCount(m) >= 120);
    decoded[rank] = masks.length ? masks : (SEEDED_RANK_TEMPLATES[rank] || []).map((s) => unpackMask(decodeBase64(s)));
  }
  return decoded;
}

export const RANK_ACCEPTANCE = Object.freeze({
  '2': { maxDistance: 0.39, minMargin: 0.03 },
  '3': { maxDistance: 0.32, minMargin: 0.035 },
  '4': { maxDistance: 0.36, minMargin: 0.12 },
  '5': { maxDistance: 0.34, minMargin: 0.015 },
  '6': { maxDistance: 0.35, minMargin: 0.04 },
  '7': { maxDistance: 0.27, minMargin: 0.20 },
  '8': { maxDistance: 0.34, minMargin: 0.005 },
  '9': { maxDistance: 0.57, minMargin: 0.02 },
  'T': { maxDistance: 0.40, minMargin: 0.055 },
  'J': { maxDistance: 0.41, minMargin: 0.07 },
  'Q': { maxDistance: 0.35, minMargin: 0.06 },
  'K': { maxDistance: 0.36, minMargin: 0.10 },
  'A': { maxDistance: 0.42, minMargin: 0.0 },
});

export function classifyRankMask(mask, opts = {}) {
  if (!mask) return { rank: null, confidence: 0, distance: 1, margin: 0, second: null };
  const scores = [];
  const db = seedDb();
  for (const rank of RANKS) {
    let d = 1;
    for (const t of db[rank] || []) d = Math.min(d, shiftedMaskDistance(mask, t, RANK_MASK_W, RANK_MASK_H, 2));
    scores.push({ rank, d });
  }
  scores.sort((a, b) => a.d - b.d);
  const best = scores[0];
  const second = scores[1];
  const margin = Math.max(0, second.d - best.d);
  const calibrated = RANK_ACCEPTANCE[best.rank] ?? { maxDistance: 0.35, minMargin: 0.055 };
  const maxDistance = opts.maxDistance ?? calibrated.maxDistance;
  const minMargin = opts.minMargin ?? calibrated.minMargin;
  const accepted = best.d <= maxDistance && margin >= minMargin;
  const distanceQuality = Math.max(0, 1 - best.d / Math.max(0.001, maxDistance));
  const marginQuality = minMargin <= 0 ? Math.min(1, margin / 0.08) : Math.min(1, margin / minMargin);
  const confidence = accepted
    ? Math.max(0.72, Math.min(0.995, 0.72 + distanceQuality * 0.18 + marginQuality * 0.10))
    : Math.max(0, Math.min(0.7, 0.15 + distanceQuality * 0.35 + Math.min(1, margin / 0.12) * 0.20));
  return {
    rank: accepted ? best.rank : null,
    candidate: best.rank,
    confidence,
    distance: best.d,
    margin,
    second: second.rank,
    gate: { maxDistance, minMargin },
  };
}

export function classifyRankPixels(data, w, h, opts = {}) {
  const mask = extractRankMask(data, w, h);
  return { ...classifyRankMask(mask, opts), mask };
}
