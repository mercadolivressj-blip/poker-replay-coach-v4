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

export function locateHeroPairRects(data, w, h) {
  if (!data || !w || !h) return null;
  const rects = detectCards(data, w, h, { max: 12, minH: 0.09, minFill: 0.11 });
  const pair = selectHeroPair(rects, w, h);
  if (!pair) return null;

  const [a, b] = pair.sort((r1, r2) => r1.x - r2.x);
  const avgH = (a.h + b.h) / 2;
  const avgW = (a.w + b.w) / 2;
  const yDiff = Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) / Math.max(1, avgH);
  const gap = b.x - (a.x + a.w);
  const center = (a.x + b.x + b.w) / 2;

  if (yDiff > 0.24) return null;
  if (gap < -avgW * 0.28 || gap > avgW * 0.78) return null;
  if (Math.abs(center / w - 0.5) > 0.34) return null;
  return [a, b];
}

function expandRect(r, w, h) {
  const ex = r.w * 0.04;
  const eyTop = r.h * 0.06;
  const eyBottom = r.h * 0.18;
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
      source: 'hero-visual-locator-r10',
    };
  });
}
