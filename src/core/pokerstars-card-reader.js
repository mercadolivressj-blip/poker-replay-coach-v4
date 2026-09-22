const NORMAL_W = 24;
const NORMAL_H = 32;

function components(binary, width, height) {
  const seen = new Uint8Array(binary.length), queue = new Int32Array(binary.length), out = [];
  for (let start = 0; start < binary.length; start++) {
    if (!binary[start] || seen[start]) continue;
    let head = 0, tail = 0, minX = width, minY = height, maxX = -1, maxY = -1, ink = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width); ink++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const np = ny * width + nx; if (binary[np] && !seen[np]) { seen[np] = 1; queue[tail++] = np; }
      }
    }
    out.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, ink });
  }
  return out;
}

function normalizedGlyph(image, kind) {
  const width = Math.min(22, image.width), height = Math.min(43, image.height), mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * image.width + x) * 4, r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), saturation = max ? (max - min) * 255 / max : 0;
    const gray = .299 * r + .587 * g + .114 * b;
    if ((gray < 175 || saturation > 85) && max < 245) mask[y * width + x] = 1;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x < 3 || y < 2 || y >= height - 2 || x >= width - 2) mask[y * width + x] = 0;
  const chosen = components(mask, width, height).filter(box => box.ink >= 4 && (kind === 'rank' ? box.y <= 8 && box.h >= 10 && box.w <= 16 : box.x <= 18 && box.y >= 24 && box.h >= 8 && box.w <= 16));
  if (!chosen.length) return [];
  const minX = Math.min(...chosen.map(b => b.x)), minY = Math.min(...chosen.map(b => b.y)), maxX = Math.max(...chosen.map(b => b.x + b.w)), maxY = Math.max(...chosen.map(b => b.y + b.h));
  const sourceW = Math.max(1, maxX - minX), sourceH = Math.max(1, maxY - minY), scale = Math.min((NORMAL_W - 4) / sourceW, (NORMAL_H - 4) / sourceH);
  const targetW = Math.max(1, Math.trunc(sourceW * scale)), targetH = Math.max(1, Math.trunc(sourceH * scale)), offsetX = Math.floor((NORMAL_W - targetW) / 2), offsetY = Math.floor((NORMAL_H - targetH) / 2), indices = [];
  const selected = new Uint8Array(width * height); for (const box of chosen) for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) if (mask[y * width + x]) selected[y * width + x] = 1;
  for (let y = 0; y < targetH; y++) for (let x = 0; x < targetW; x++) {
    const sx = Math.min(sourceW - 1, Math.floor(x * sourceW / targetW)), sy = Math.min(sourceH - 1, Math.floor(y * sourceH / targetH));
    if (selected[(minY + sy) * width + minX + sx]) indices.push((offsetY + y) * NORMAL_W + offsetX + x);
  }
  return indices;
}

function iou(a, b) {
  let ai = 0, bi = 0, intersection = 0;
  while (ai < a.length && bi < b.length) { if (a[ai] === b[bi]) { intersection++; ai++; bi++; } else if (a[ai] < b[bi]) ai++; else bi++; }
  return intersection / (a.length + b.length - intersection + 1e-6);
}

function classify(patch, bank, minimum, margin) {
  const rows = Object.entries(bank).map(([label, templates]) => [label, Math.max(...templates.map(t => iou(patch, t)))]).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return { label: null, score: 0, margin: 0 };
  const gap = rows[0][1] - (rows[1]?.[1] || 0), accepted = rows[0][1] >= minimum && gap >= margin;
  return { label: accepted ? rows[0][0] : null, score: rows[0][1], margin: gap };
}

export class PokerStarsCardReader {
  constructor(bank, profile = 'board') { this.profile = bank[profile]; }

  readImageData(image) {
    const startedAt = performance.now(), t = this.profile.thresholds;
    const rank = classify(normalizedGlyph(image, 'rank'), this.profile.ranks, t.rankMin, t.rankMargin);
    const suit = classify(normalizedGlyph(image, 'suit'), this.profile.suits, t.suitMin, t.suitMargin);
    return { card: rank.label && suit.label ? rank.label + suit.label : null, confidence: Math.min(rank.score, suit.score), rank, suit, latencyMs: performance.now() - startedAt };
  }

  readCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return this.readImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }
}

export const __private = { components, normalizedGlyph, iou, classify };
