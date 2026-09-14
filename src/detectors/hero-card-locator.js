import { detectCards, selectHeroPair } from './cards.js';
import { cropCanvas } from '../core/image.js';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Search only the bottom-center Hero zone and locate the two physical white card
 * faces. This is intentionally independent from rank/suit classification: it
 * answers only "where are the two visible Hero cards right now?".
 */
export function heroSearchRect(felt) {
  if (!felt) return null;
  const x = clamp(felt.x + felt.w * 0.23, 0, 0.96);
  const y = clamp(felt.y + felt.h * 0.73, 0, 0.96);
  const w = clamp(felt.w * 0.54, 0.12, 1 - x);
  const h = clamp(felt.h * 0.34, 0.08, 1 - y);
  return { x, y, w, h };
}

function verticalOverlap(a, b) {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, bottom - top) / Math.max(1, Math.min(a.h, b.h));
}

function mergeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y, mergedHeroFragments: true };
}

/**
 * PokerStars face cards / red pip layouts can split one physical white card into
 * two horizontal runs in the generic white-mask detector. In real replay frames
 * this produced [left half of card 1] [right half of card 1] [card 2], and the
 * Hero locator mistakenly selected the two halves as the two hole cards.
 *
 * Merge only pairs where BOTH components are narrow fragments. Real adjacent
 * cards are close too, but a complete card is normally much wider relative to
 * its height, so it must never be merged with its neighbour here.
 */
export function mergeHeroCardFragments(rects = []) {
  const sorted = [...rects].sort((a, b) => a.x - b.x);
  const out = [];

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!b) {
      out.push(a);
      continue;
    }

    const arA = a.w / Math.max(1, a.h);
    const arB = b.w / Math.max(1, b.h);
    const bothNarrow = arA >= 0.34 && arA <= 0.84 && arB >= 0.34 && arB <= 0.84;
    const overlap = verticalOverlap(a, b);
    const centerYDelta = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) / Math.max(1, Math.max(a.h, b.h));
    const gap = b.x - (a.x + a.w);
    const gapLimit = Math.max(a.w, b.w) * 0.22;
    const combined = mergeRect(a, b);
    const combinedAspect = combined.w / Math.max(1, combined.h);
    const plausibleCard = combinedAspect >= 0.62 && combinedAspect <= 1.62;

    if (
      bothNarrow
      && overlap >= 0.78
      && centerYDelta <= 0.18
      && gap >= -gapLimit * 0.45
      && gap <= gapLimit
      && plausibleCard
    ) {
      out.push(combined);
      i++;
      continue;
    }

    out.push(a);
  }

  return out;
}

export function locateHeroPairRects(data, w, h) {
  if (!data || !w || !h) return null;
  const rawRects = detectCards(data, w, h, { max: 12, minH: 0.09, minFill: 0.11 });
  const rects = mergeHeroCardFragments(rawRects);
  const pair = selectHeroPair(rects, w, h);
  if (!pair) return null;

  const [a, b] = pair.sort((r1, r2) => r1.x - r2.x);
  const avgH = (a.h + b.h) / 2;
  const avgW = (a.w + b.w) / 2;
  const yDiff = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) / Math.max(1, avgH);
  const gap = b.x - (a.x + a.w);
  const center = (a.x + b.x + b.w) / 2;

  if (yDiff > 0.30) return null;
  if (gap < -avgW * 0.28 || gap > avgW * 0.78) return null;
  if (Math.abs(center / w - 0.5) > 0.34) return null;
  return [a, b];
}

function expandRect(r, w, h) {
  const ex = r.w * 0.04;
  const eyTop = r.h * 0.10;
  const eyBottom = r.h * 0.20;
  const x = clamp(r.x - ex, 0, w - 1);
  const y = clamp(r.y - eyTop, 0, h - 1);
  const right = clamp(r.x + r.w + ex, x + 2, w);
  const bottom = clamp(r.y + r.h + eyBottom, y + 2, h);
  return { x, y, w: right - x, h: bottom - y };
}

export function locateHeroCardSlots(frameCanvas, felt, scratchCanvas = null) {
  const search = heroSearchRect(felt);
  if (!frameCanvas || !search) return null;
  const crop = cropCanvas(frameCanvas, search, 460, scratchCanvas);
  const pair = locateHeroPairRects(crop.data, crop.w, crop.h);
  if (!pair) return null;

  return pair.map((raw) => {
    const r = expandRect(raw, crop.w, crop.h);
    return {
      x: search.x + (r.x / crop.w) * search.w,
      y: search.y + (r.y / crop.h) * search.h,
      w: (r.w / crop.w) * search.w,
      h: (r.h / crop.h) * search.h,
      source: 'hero-visual-locator-r14',
    };
  });
}
