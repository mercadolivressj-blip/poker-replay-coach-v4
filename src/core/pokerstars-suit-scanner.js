import { luma, sat } from './image.js';
import { cardFaceBox, shiftedMaskDistance, unpackMask } from './rank-mask.js';
import { classifySuitPixels as classifyLegacySuitPixels } from './suit-classifier.js';

export const POKERSTARS_SUIT_MASK_W = 24;
export const POKERSTARS_SUIT_MASK_H = 24;

// Multiple normalized exemplars captured from the same PokerStars replay deck
// used by the product. The scanner is intentionally icon-specific: rank reading
// is a separate concern, while these masks answer only one question: which suit
// glyph is printed in the top-left corner of the visible card?
const TEMPLATE_BANK_B64 = Object.freeze({
  clubs: Object.freeze([
    'AAAAAAAAAAAAAHAAAPgAAPgAAPgAAPAAAPAAAGAAAG8PwP8fwP8/wL8fAK8fACAAAGAAAGAAHHAA/PsA/A8AAAAAAAAAAAAA',
    'AAAAAAAAABwAAB8AAB8AgH8AgH8AAB8AAB8AAAwA8OwH+P8P+P8P+P8P+P8P+OgH+OgHAAwAAAwAAAwAAAwAAH8AAAAAAAAA',
  ]),
  spades: Object.freeze([
    'AAAAAAAAAAAAAGAAAPAAAPgDAPwHAP4HAP4HAP8PAP8fwP8fwP8/wP8/AP8fAC4PAGAAAGAAHHAA/PsA/A8AAAAAAAAAAAAA',
  ]),
  hearts: Object.freeze([
    'AAAAAAAA+P8f/P8f/P8f/P8//P8//P8//P8//P8//P8/+P8f+P8f+P8f4P8HwP8DwP8DAP8AAH4AAH4AABgAAAAAAAAAAAAA',
    'AAAAAAAAAAAA4Ocf+P8f+P8f+P8//P8/+P8/+P8/+P8/+P8f4P8HwP8HwP8HgP8DAP4BAHwAAHwAADgAAAAAAAAAAAAAAAAA',
  ]),
  diamonds: Object.freeze([
    'AAAAAAAAABgAAB4AAH4AAH4AAP8AAP8AgP8BgP8BwP8D8P8P+P8f8P8PwP8DwP8DgP8BAP8AAH4AAB4AAB4AABgAAAAAAAAA',
  ]),
});

let decodedTemplates = null;
function decodeBase64(s) {
  if (typeof atob === 'function') {
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(s, 'base64'));
}

function templateBank() {
  if (decodedTemplates) return decodedTemplates;
  decodedTemplates = Object.fromEntries(
    Object.entries(TEMPLATE_BANK_B64).map(([suit, rows]) => [
      suit,
      rows.map((b64) => unpackMask(decodeBase64(b64), POKERSTARS_SUIT_MASK_W * POKERSTARS_SUIT_MASK_H)),
    ]),
  );
  return decodedTemplates;
}

function connected(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const out = [];
  const stack = [];
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const start = sy * w + sx;
      if (!mask[start] || seen[start]) continue;
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      const pts = [];
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      while (stack.length) {
        const p = stack.pop();
        const x = p % w;
        const y = Math.floor(p / w);
        pts.push(p);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const ni = ny * w + nx;
            if (!mask[ni] || seen[ni]) continue;
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }
      out.push({
        pts,
        area: pts.length,
        minX,
        maxX,
        minY,
        maxY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
      });
    }
  }
  return out;
}

function normalizeComponent(component, redInk, roiW, outW = POKERSTARS_SUIT_MASK_W, outH = POKERSTARS_SUIT_MASK_H) {
  const glyph = new Uint8Array(component.w * component.h);
  let redCount = 0;
  for (const p of component.pts) {
    const x = p % roiW;
    const y = Math.floor(p / roiW);
    glyph[(y - component.minY) * component.w + (x - component.minX)] = 1;
    if (redInk[p]) redCount++;
  }

  const scale = Math.min((outW - 4) / component.w, (outH - 4) / component.h);
  const nw = Math.max(1, Math.round(component.w * scale));
  const nh = Math.max(1, Math.round(component.h * scale));
  const ox = Math.floor((outW - nw) / 2);
  const oy = Math.floor((outH - nh) / 2);
  const out = new Uint8Array(outW * outH);
  for (let dy = 0; dy < nh; dy++) {
    const sy = Math.min(component.h - 1, Math.floor((dy + 0.5) / scale));
    for (let dx = 0; dx < nw; dx++) {
      const sx = Math.min(component.w - 1, Math.floor((dx + 0.5) / scale));
      if (glyph[sy * component.w + sx]) out[(oy + dy) * outW + (ox + dx)] = 1;
    }
  }

  const redRatio = redCount / Math.max(1, component.area);
  return {
    mask: out,
    family: redRatio >= 0.30 ? 'red' : 'black',
    redRatio,
  };
}

/**
 * Locate the actual corner suit glyph, not a generic dark blob. PokerStars keeps
 * this icon in a very stable place even when rank, face art and centre pips vary.
 */
export function extractPokerStarsSuitGlyph(data, w, h) {
  if (!data || !w || !h) return null;
  const box = cardFaceBox(data, w, h);
  if (!box) return null;

  const x0 = Math.max(0, Math.round(box.x));
  const x1 = Math.min(w, Math.round(box.x + box.w * 0.32));
  const y0 = Math.max(0, Math.round(box.y + box.h * 0.30));
  const y1 = Math.min(h, Math.round(box.y + box.h));
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw < 5 || rh < 8) return null;

  const ink = new Uint8Array(rw * rh);
  const redInk = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = ((y0 + y) * w + (x0 + x)) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const L = luma(r, g, b);
      const S = sat(r, g, b);
      const red = r > 85 && r > g * 1.12 && r > b * 1.05 && S > 0.10;
      const dark = L < 155 && S < 0.72;
      if (red || dark) ink[y * rw + x] = 1;
      if (red) redInk[y * rw + x] = 1;
    }
  }

  const candidates = [];
  for (const c of connected(ink, rw, rh)) {
    if (c.area < 4 || c.w < 2 || c.h < 2) continue;
    const cx = (x0 + (c.minX + c.maxX) / 2 - box.x) / Math.max(1, box.w);
    const cy = (y0 + (c.minY + c.maxY) / 2 - box.y) / Math.max(1, box.h);
    if (cy < 0.50 || cy > 0.92 || cx > 0.28) continue;
    if (c.w > rw * 0.90 || c.h > rh * 0.80) continue;
    const verticalShape = c.h >= c.w * 0.70 ? 1.05 : 1;
    const placement = Math.max(0.55, 1.30 - Math.abs(cy - 0.68));
    const score = c.area * placement * verticalShape;
    candidates.push({ c, score, cx, cy });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  const normalized = normalizeComponent(winner.c, redInk, rw);
  const compactness = winner.c.area / Math.max(1, winner.c.w * winner.c.h);
  const quality = Math.max(0, Math.min(1,
    0.68 + Math.min(0.18, compactness * 0.22) - Math.abs(winner.cy - 0.68) * 0.16,
  ));
  return {
    ...normalized,
    quality,
    roi: 'pokerstars-corner-fixed',
    component: {
      x: x0 + winner.c.minX,
      y: y0 + winner.c.minY,
      w: winner.c.w,
      h: winner.c.h,
      area: winner.c.area,
      cx: winner.cx,
      cy: winner.cy,
    },
  };
}

export function classifyPokerStarsSuitMask(mask, family = null) {
  if (!mask) return { suit: null, candidate: null, confidence: 0, distance: 1, margin: 0, family };
  const allowed = family === 'red'
    ? ['hearts', 'diamonds']
    : family === 'black'
      ? ['spades', 'clubs']
      : ['spades', 'clubs', 'hearts', 'diamonds'];
  const bank = templateBank();
  const scores = allowed.map((suit) => {
    const distances = bank[suit].map((template) => shiftedMaskDistance(mask, template, POKERSTARS_SUIT_MASK_W, POKERSTARS_SUIT_MASK_H, 2));
    return { suit, d: Math.min(...distances) };
  }).sort((a, b) => a.d - b.d);
  const best = scores[0];
  const second = scores[1] || { d: 1 };
  const margin = Math.max(0, second.d - best.d);
  // At small replay scales clubs and spades can differ by only a handful of
  // pixels after normalization. If the absolute match is already very close to
  // a real PokerStars template, allow a smaller inter-suit margin; otherwise
  // keep the conservative margin used by the generic path.
  const closeTemplateMatch = best.d <= 0.30 && margin >= 0.008;
  const separatedMatch = best.d <= 0.56 && margin >= 0.055;
  const accepted = closeTemplateMatch || separatedMatch;
  const confidence = accepted
    ? Math.max(0.88, Math.min(0.998, 0.90 + (0.56 - best.d) * 0.12 + Math.min(0.24, margin) * 0.22))
    : Math.max(0.18, Math.min(0.74, 0.62 + (0.56 - best.d) * 0.10 + margin * 0.18));
  return {
    suit: accepted ? best.suit : null,
    candidate: best.suit,
    confidence,
    distance: best.d,
    margin,
    family,
    scores,
  };
}

/**
 * R9 suit path: deterministic PokerStars icon scanner first, legacy heuristic
 * only as a fallback when the corner itself is genuinely unavailable.
 */
export function classifyPokerStarsSuitPixels(data, w, h, rank = null) {
  const glyph = extractPokerStarsSuitGlyph(data, w, h);
  if (glyph?.mask) {
    const direct = classifyPokerStarsSuitMask(glyph.mask, glyph.family);
    if (direct.suit) {
      return {
        ...direct,
        mask: glyph.mask,
        redRatio: glyph.redRatio,
        quality: glyph.quality,
        roi: glyph.roi,
        voteCount: 1,
        rankAware: !!rank,
        scanner: 'pokerstars-corner-template-r9',
      };
    }

    // Preserve the strong fixed-corner candidate so temporal SuitConsensus can
    // accumulate it across frames instead of losing the evidence to a generic ROI.
    const legacy = classifyLegacySuitPixels(data, w, h, rank);
    if (legacy?.suit && (!direct.candidate || legacy.suit === direct.candidate)) {
      return {
        ...legacy,
        confidence: Math.max(legacy.confidence || 0, direct.confidence || 0),
        candidate: legacy.suit,
        family: glyph.family || legacy.family,
        roi: legacy.roi || glyph.roi,
        scanner: 'pokerstars-corner+legacy-r9',
      };
    }
    return {
      ...direct,
      suit: null,
      mask: glyph.mask,
      redRatio: glyph.redRatio,
      quality: glyph.quality,
      roi: glyph.roi,
      voteCount: 0,
      rankAware: !!rank,
      scanner: 'pokerstars-corner-candidate-r9',
    };
  }

  return {
    ...classifyLegacySuitPixels(data, w, h, rank),
    scanner: 'legacy-fallback-r9',
  };
}

export const POKERSTARS_SUIT_TEMPLATE_BANK = TEMPLATE_BANK_B64;
