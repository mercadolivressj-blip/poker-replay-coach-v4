import { luma, sat } from './image.js';

export const RANK_MASK_W = 28;
export const RANK_MASK_H = 36;

function connected(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const comps = [];
  const qx = new Int16Array(w * h);
  const qy = new Int16Array(w * h);
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const start = sy * w + sx;
      if (!mask[start] || seen[start]) continue;
      let head = 0, tail = 0;
      qx[tail] = sx; qy[tail] = sy; tail++; seen[start] = 1;
      let minX = sx, maxX = sx, minY = sy, maxY = sy, area = 0;
      while (head < tail) {
        const x = qx[head], y = qy[head]; head++; area++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const ni = ny * w + nx;
            if (!mask[ni] || seen[ni]) continue;
            seen[ni] = 1; qx[tail] = nx; qy[tail] = ny; tail++;
          }
        }
      }
      comps.push({ minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1, area });
    }
  }
  return comps;
}

export function cardFaceBox(data, w, h) {
  if (!data || !w || !h) return null;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b);
      const neutral = sat(r, g, b) < 0.46;
      mask[y * w + x] = mx > 150 && neutral ? 1 : 0;
    }
  }
  const minArea = Math.max(30, w * h * 0.008);
  let best = null;
  for (const c of connected(mask, w, h)) {
    if (c.area < minArea || c.w < Math.max(4, w * 0.06) || c.h < Math.max(8, h * 0.1)) continue;
    const score = c.area * (c.minY < h * 0.4 ? 1.3 : 1) * (c.h > h * 0.35 ? 1.2 : 1);
    if (!best || score > best.score) best = { ...c, score };
  }
  return best ? { x: best.minX, y: best.minY, w: best.w, h: best.h } : { x: 0, y: 0, w, h };
}

export function extractRankMask(data, w, h, outW = RANK_MASK_W, outH = RANK_MASK_H) {
  const box = cardFaceBox(data, w, h);
  if (!box) return null;
  const x0 = Math.max(0, Math.round(box.x + Math.max(1, box.w * 0.01)));
  const y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(w, Math.round(box.x + box.w * 0.42));
  const y1 = Math.min(h, Math.round(box.y + box.h * 0.44));
  const rw = Math.max(1, x1 - x0), rh = Math.max(1, y1 - y0);
  if (rw < 3 || rh < 3) return null;

  const ink = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = ((y0 + y) * w + (x0 + x)) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const L = luma(r, g, b);
      const S = sat(r, g, b);
      const red = r > 95 && r > g * 1.18 && r > b * 1.10 && S > 0.14;
      const dark = L < 150 && S < 0.62;
      ink[y * rw + x] = red || dark ? 1 : 0;
    }
  }

  const comps = connected(ink, rw, rh).filter((c) => {
    if (c.area < 3 || c.h < 3) return false;
    if (c.minX <= 1 && c.w <= Math.max(2, rw * 0.08) && c.h > rh * 0.45) return false;
    if (c.h <= Math.max(3, rh * 0.14) && c.w >= Math.max(8, c.h * 3)) return false;
    if (c.minY <= 1 && c.h <= Math.max(3, rh * 0.13) && c.w >= rw * 0.45) return false;
    return true;
  });
  if (!comps.length) return null;

  const substantial = comps.filter((c) => c.h >= Math.max(4, rh * 0.16) && c.area >= 8);
  const pool = substantial.length ? substantial : comps;
  const top = Math.min(...pool.map((c) => c.minY));
  let rank = comps.filter(
    (c) =>
      c.minY <= top + Math.max(3, Math.floor(rh * 0.10)) &&
      c.h >= Math.max(4, rh * 0.15) &&
      c.area >= 6,
  );
  if (!rank.length) rank = [pool.reduce((a, b) => (a.minY <= b.minY ? a : b))];

  const minX = Math.min(...rank.map((c) => c.minX));
  const minY = Math.min(...rank.map((c) => c.minY));
  const maxX = Math.max(...rank.map((c) => c.maxX));
  const maxY = Math.max(...rank.map((c) => c.maxY));
  const gw = Math.max(1, maxX - minX + 1), gh = Math.max(1, maxY - minY + 1);

  const scale = Math.min((outW - 4) / gw, (outH - 4) / gh);
  const nw = Math.max(1, Math.round(gw * scale));
  const nh = Math.max(1, Math.round(gh * scale));
  const ox = Math.floor((outW - nw) / 2), oy = Math.floor((outH - nh) / 2);
  const out = new Uint8Array(outW * outH);

  const selected = new Uint8Array(rw * rh);
  for (const c of rank) {
    for (let y = c.minY; y <= c.maxY; y++) {
      for (let x = c.minX; x <= c.maxX; x++) {
        if (ink[y * rw + x]) selected[y * rw + x] = 1;
      }
    }
  }
  for (let dy = 0; dy < nh; dy++) {
    const sy = Math.min(gh - 1, Math.floor((dy + 0.5) / scale));
    for (let dx = 0; dx < nw; dx++) {
      const sx = Math.min(gw - 1, Math.floor((dx + 0.5) / scale));
      out[(oy + dy) * outW + (ox + dx)] = selected[(minY + sy) * rw + (minX + sx)] ? 1 : 0;
    }
  }
  return out;
}

export function shiftedMaskDistance(a, b, w = RANK_MASK_W, h = RANK_MASK_H, maxShift = 2) {
  if (!a || !b || a.length !== b.length) return 1;
  let best = 1;
  for (let sy = -maxShift; sy <= maxShift; sy++) {
    for (let sx = -maxShift; sx <= maxShift; sx++) {
      let union = 0, xor = 0;
      for (let y = 0; y < h; y++) {
        const by = y - sy;
        for (let x = 0; x < w; x++) {
          const bx = x - sx;
          const av = a[y * w + x] ? 1 : 0;
          const bv = bx >= 0 && bx < w && by >= 0 && by < h && b[by * w + bx] ? 1 : 0;
          if (av || bv) union++;
          if (av !== bv) xor++;
        }
      }
      const d = xor / Math.max(1, union);
      if (d < best) best = d;
    }
  }
  return best;
}

export function packMask(mask) {
  const bytes = new Uint8Array(Math.ceil(mask.length / 8));
  for (let i = 0; i < mask.length; i++) if (mask[i]) bytes[i >> 3] |= 1 << (i & 7);
  return bytes;
}

export function unpackMask(bytes, length = RANK_MASK_W * RANK_MASK_H) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = bytes[i >> 3] & (1 << (i & 7)) ? 1 : 0;
  return out;
}
