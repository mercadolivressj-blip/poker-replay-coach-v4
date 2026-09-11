import { luma, sat, clamp } from './image.js';

function isFeltPixel(r, g, b) {
  return g > r * 1.18 && g > b * 1.12 && g > 55 && sat(r, g, b) > 0.25 && luma(r, g, b) > 40;
}

/**
 * Pure largest-component felt detector. The old implementation used min/max of
 * every green pixel in the frame, so green action buttons/progress bars pulled
 * the table bounds all the way to the bottom of the screen. Here only the
 * largest connected green component near the centre can become the felt.
 */
export function detectFeltPixels(data, w, h) {
  if (!data || !w || !h) return null;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      mask[y * w + x] = isFeltPixel(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
    }
  }

  const seen = new Uint8Array(w * h);
  const qx = new Int16Array(w * h);
  const qy = new Int16Array(w * h);
  let best = null;

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const start = sy * w + sx;
      if (!mask[start] || seen[start]) continue;
      let head = 0;
      let tail = 0;
      let minX = sx;
      let maxX = sx;
      let minY = sy;
      let maxY = sy;
      let count = 0;
      qx[tail] = sx;
      qy[tail] = sy;
      tail++;
      seen[start] = 1;

      while (head < tail) {
        const x = qx[head];
        const y = qy[head];
        head++;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const neighbours = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ];
        for (const [nx, ny] of neighbours) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (!mask[ni] || seen[ni]) continue;
          seen[ni] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (count < w * h * 0.02 || bw < w * 0.25 || bh < h * 0.18) continue;
      const cx = (minX + maxX) / 2 / w;
      const cy = (minY + maxY) / 2 / h;
      const centerPenalty = Math.min(0.8, Math.abs(cx - 0.5) + Math.abs(cy - 0.43) * 0.7);
      const score = count * (1 - centerPenalty);
      if (!best || score > best.score) best = { minX, maxX, minY, maxY, count, score };
    }
  }

  if (!best) return null;
  const padX = (best.maxX - best.minX) * 0.025;
  const padY = (best.maxY - best.minY) * 0.04;
  const x = clamp((best.minX - padX) / w, 0, 1);
  const y = clamp((best.minY - padY) / h, 0, 1);
  const right = clamp((best.maxX + padX) / w, 0, 1);
  const bottom = clamp((best.maxY + padY) / h, 0, 1);
  return {
    x,
    y,
    w: Math.max(0.2, right - x),
    h: Math.max(0.15, bottom - y),
    confidence: Math.min(1, best.count / (w * h * 0.16)),
  };
}

export function detectFelt(frame) {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = Math.max(120, Math.round((frame.h / frame.w) * 240));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(frame.canvas, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  return detectFeltPixels(d, c.width, c.height);
}

const C = (x, y, w, h) => {
  const nx = clamp(x, 0, 0.995);
  const ny = clamp(y, 0, 0.995);
  return {
    x: nx,
    y: ny,
    w: clamp(w, 0.008, 1 - nx),
    h: clamp(h, 0.008, 1 - ny),
  };
};

/**
 * PokerStars slot geometry derived from the felt itself. These are not fixed
 * screen coordinates: the whole layout scales and moves with the detected table.
 * Slot-first geometry is much more reliable than rediscovering white blobs every
 * frame, especially for face cards and fast hand transitions.
 */
export function layoutFromFelt(f) {
  const heroSlots = [0, 1].map((i) =>
    C(f.x + (0.405 + i * 0.09) * f.w, f.y + 0.94 * f.h, 0.09 * f.w, 0.17 * f.h),
  );
  const boardSlots = [0, 1, 2, 3, 4].map((i) =>
    C(f.x + (0.255 + i * 0.1) * f.w, f.y + 0.265 * f.h, 0.09 * f.w, 0.29 * f.h),
  );
  const pot = C(f.x + 0.395 * f.w, f.y + 0.135 * f.h, 0.21 * f.w, 0.18 * f.h);
  const actionX = f.x + 0.5 * f.w;
  const actionY = f.y + 1.28 * f.h;
  const action = C(actionX, actionY, 1 - actionX - 0.005, 1 - actionY - 0.018);
  return { heroSlots, boardSlots, pot, action };
}

/** Compatibility wrapper for older code. */
export function zonesFromFelt(f) {
  const l = layoutFromFelt(f);
  const hero = C(
    l.heroSlots[0].x - 0.03 * f.w,
    l.heroSlots[0].y - 0.06 * f.h,
    l.heroSlots[1].x + l.heroSlots[1].w - l.heroSlots[0].x + 0.06 * f.w,
    l.heroSlots[0].h + 0.12 * f.h,
  );
  const board = C(
    l.boardSlots[0].x - 0.02 * f.w,
    l.boardSlots[0].y - 0.06 * f.h,
    l.boardSlots[4].x + l.boardSlots[4].w - l.boardSlots[0].x + 0.04 * f.w,
    l.boardSlots[0].h + 0.12 * f.h,
  );
  return { hero, board, pot: l.pot, action: l.action };
}

export function feltDistance(a, b) {
  if (!a || !b) return 1;
  return (
    Math.abs(a.x - b.x) +
    Math.abs(a.y - b.y) +
    Math.abs(a.w - b.w) +
    Math.abs(a.h - b.h)
  );
}

/** Smooth tiny detector jitter without delaying a real window move. */
export function stabilizeFelt(previous, next) {
  if (!previous) return next;
  if (!next) return previous;
  if (feltDistance(previous, next) > 0.12) return next;
  const a = 0.22;
  return {
    x: previous.x * (1 - a) + next.x * a,
    y: previous.y * (1 - a) + next.y * a,
    w: previous.w * (1 - a) + next.w * a,
    h: previous.h * (1 - a) + next.h * a,
    confidence: Math.max(previous.confidence ?? 0, next.confidence ?? 0),
  };
}
