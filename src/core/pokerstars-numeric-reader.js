const NORMAL_W = 24;
const NORMAL_H = 32;

function binaryFromImageData(image) {
  const { data, width, height } = image;
  const binary = new Uint8Array(width * height);
  for (let i = 0, pixel = 0; pixel < binary.length; pixel++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : ((max - min) * 255) / max;
    if (saturation < 155 && max > 80) binary[pixel] = 1;
  }
  return binary;
}

function components(binary, width, height) {
  const seen = new Uint8Array(binary.length);
  const found = [];
  const queue = new Int32Array(binary.length);
  for (let start = 0; start < binary.length; start++) {
    if (!binary[start] || seen[start]) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let minX = width, minY = height, maxX = -1, maxY = -1, ink = 0;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y); ink++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const np = ny * width + nx;
        if (binary[np] && !seen[np]) { seen[np] = 1; queue[tail++] = np; }
      }
    }
    found.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, ink });
  }
  return found;
}

function commitmentLayout(image) {
  const binary = binaryFromImageData(image);
  const all = components(binary, image.width, image.height);
  const glyphs = all.filter(b => b.h >= 7 && b.h <= 16 && b.w <= 12 && b.ink >= 10).sort((a, b) => a.x - b.x);
  if (glyphs.length < 4) return { layout: null, binary, glyphs };
  const prefixes = [];
  for (let i = 0; i < glyphs.length - 3; i++) {
    const [a, b, c] = glyphs.slice(i, i + 3);
    if (Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y) > 4) continue;
    if (b.x - (a.x + a.w) > 5 || c.x - (b.x + b.w) > 5) continue;
    for (let j = i + 3; j < glyphs.length; j++) {
      const d = glyphs[j], gap = d.x - (c.x + c.w);
      if (gap < 3) continue;
      if (gap > 16) break;
      const base = Math.round((a.y + b.y + c.y + d.y) / 4);
      if (Math.abs(d.y - base) <= 4) { prefixes.push({ j, base }); break; }
    }
  }
  const candidates = [];
  for (const { j, base } of prefixes) {
    const amount = [];
    for (const b of glyphs.slice(j)) {
      if (Math.abs(b.y - base) > 4) continue;
      if (amount.length && b.x - (amount.at(-1).x + amount.at(-1).w) > 18) break;
      amount.push(b);
    }
    if (!amount.length) continue;
    const punctuation = all.filter(b => b.w >= 1 && b.w <= 4 && b.h >= 1 && b.h <= 5 && b.ink >= 3 && b.y >= base + 7 && b.y <= base + 16).sort((a, b) => a.x - b.x);
    let comma = null;
    for (const p of punctuation) {
      const before = amount.filter(b => b.x + b.w <= p.x + 1);
      const after = amount.filter(b => b.x >= p.x + p.w);
      if (before.length < 1 || before.length > 3 || after.length < 2) continue;
      const left = before.at(-1), right = after[0];
      if (p.x - (left.x + left.w) <= 6 && right.x - (p.x + p.w) <= 7) { comma = p; break; }
    }
    if (comma) {
      const before = amount.filter(b => b.x + b.w <= comma.x + 1).slice(-3);
      const after = amount.filter(b => b.x >= comma.x + comma.w).slice(0, 2);
      if (before.length >= 1 && before.length <= 3 && after.length === 2) {
        const boxes = before.concat(after);
        candidates.push({ score: boxes.reduce((n, b) => n + b.ink, 0), decimal: true, nint: before.length, boxes });
        continue;
      }
    }
    const chain = [amount[0]];
    for (const b of amount.slice(1)) {
      if (b.x - (chain.at(-1).x + chain.at(-1).w) <= 6 && chain.length < 3) chain.push(b);
      else break;
    }
    if (chain.length) candidates.push({ score: chain.reduce((n, b) => n + b.ink, 0), decimal: false, nint: chain.length, boxes: chain });
  }
  if (!candidates.length) {
    const punctuation = all.filter(b => b.w >= 1 && b.w <= 4 && b.h >= 1 && b.h <= 6 && b.ink >= 3).sort((a, b) => a.x - b.x);
    for (const p of punctuation) {
      const aligned = glyphs.filter(b => Math.abs((b.y + b.h) - (p.y + p.h)) <= 5);
      const left = aligned.filter(b => b.x + b.w <= p.x + 1);
      const right = aligned.filter(b => b.x >= p.x + p.w);
      if (right.length < 2 || !left.length) continue;
      const after = right.slice(0, 2);
      if (after[0].x - (p.x + p.w) > 7 || after[1].x - (after[0].x + after[0].w) > 5) continue;
      const before = [left.at(-1)];
      for (const b of left.slice(0, -1).reverse()) {
        if (before.at(-1).x - (b.x + b.w) <= 4 && before.length < 3) before.push(b);
        else break;
      }
      before.reverse();
      if (p.x - (before.at(-1).x + before.at(-1).w) > 6) continue;
      const boxes = before.concat(after);
      candidates.push({ score: boxes.reduce((n, b) => n + b.ink, 0), decimal: true, nint: before.length, boxes });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return { layout: candidates[0] || null, binary, glyphs };
}

function moneyBinary(image) {
  const { data, width, height } = image;
  const binary = new Uint8Array(width * height);
  for (let i = 0, pixel = 0; pixel < binary.length; pixel++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : ((max - min) * 255) / max;
    if (saturation < 115 && max > 160) binary[pixel] = 1;
  }
  return binary;
}

function moneyLayout(image, profile) {
  const binary = moneyBinary(image), all = components(binary, image.width, image.height);
  const usable = all.filter(b => b.h >= 2 && b.ink >= 3 && b.w <= 32 && b.y <= image.height - 4 && b.x < (image.width > 75 ? 65 : 60)).sort((a, b) => a.x - b.x);
  if (!usable.length) return { layout: null, binary };
  const chain = [usable.at(-1)];
  for (const b of usable.slice(0, -1).reverse()) {
    const current = chain.at(-1), gap = current.x - (b.x + b.w);
    if (gap <= 3 || (gap <= 5 && (b.w <= 5 || current.w <= 5))) chain.push(b);
    else break;
  }
  chain.reverse();
  const start = Math.min(...chain.map(b => b.x)), end = Math.max(...chain.map(b => b.x + b.w));
  const style = profile === 'stack' ? 'stack' : 'pot';
  const commaCandidates = all.filter(b => b.w >= 1 && b.w <= 6 && b.h >= 2 && b.h <= 8 && b.y >= image.height * .60 && b.ink >= 3);
  let comma = commaCandidates.length ? Math.max(...commaCandidates.map(b => b.x)) : null;
  const decimal = (comma != null && comma >= start && comma < end) || end - start > 30;
  const anchor = chain.filter(b => b.h >= 7).sort((a, b) => b.x - a.x)[0] || chain.at(-1);
  if (decimal) {
    if (comma == null) {
      const y0 = Math.max(0, image.height - (style === 'stack' ? 5 : 8));
      const y1 = image.height - (style === 'stack' ? 0 : 4), runs = [];
      let run = null;
      for (let x = start; x <= end; x++) {
        let count = 0; for (let y = y0; y < y1; y++) count += binary[y * image.width + x];
        if (count && run == null) run = { x, ink: 0 };
        if (run) run.ink += count;
        if ((!count || x === end) && run) { const w = x - run.x + (count ? 1 : 0); if (w >= 1 && w <= 6 && run.ink <= 16) runs.push(run.x); run = null; }
      }
      comma = runs.at(-1) ?? null;
    }
    if (comma == null) return { layout: null, binary };
    const nint = chain.filter(b => b.h >= 7 && b.x + b.w <= comma + 1).length;
    if (nint < 1 || nint > 3) return { layout: null, binary };
    return { layout: { decimal: true, style, nint, comma, anchor }, binary };
  }
  const digits = chain.filter(b => b.h >= 7);
  if (digits.length < 1 || digits.length > 3) return { layout: null, binary };
  return { layout: { decimal: false, style, nint: digits.length, boxes: digits, anchor: digits.at(-1) }, binary };
}

function moneyBoxes(binary, width, height, layout) {
  if (!layout) return [];
  if (layout.boxes) return layout.boxes;
  const comma = layout.comma, n = layout.nint, anchor = layout.anchor;
  const last = comma - (layout.style === 'stack' ? 10 : 9), pitch = 9;
  const decimal = layout.style === 'stack' ? [comma + 4, comma + 14] : [comma + 4, comma + 13];
  const starts = Array.from({ length: n }, (_, i) => last - pitch * (n - 1 - i)).concat(decimal);
  const y0 = Math.max(0, anchor.y - 2), y1 = Math.min(height, anchor.y + anchor.h + 4), out = [];
  for (const x0 of starts) {
    const xa = Math.max(0, Math.trunc(x0) - 1), xb = Math.min(width, xa + 11), w = xb - xa, h = y1 - y0;
    const part = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) part[y * w + x] = binary[(y0 + y) * width + xa + x];
    const candidates = components(part, w, h).filter(b => b.h >= 7 && b.ink >= 9 && b.w <= 11).sort((a, b) => b.ink - a.ink);
    if (!candidates.length) return [];
    const b = candidates[0]; out.push({ x: xa + b.x, y: y0 + b.y, w: b.w, h: b.h, ink: b.ink });
  }
  return out;
}

function normalizeBox(binary, sourceWidth, box) {
  const scale = Math.min((NORMAL_W - 4) / Math.max(1, box.w), (NORMAL_H - 4) / Math.max(1, box.h));
  const targetW = Math.max(1, Math.trunc(box.w * scale));
  const targetH = Math.max(1, Math.trunc(box.h * scale));
  const offsetX = Math.floor((NORMAL_W - targetW) / 2), offsetY = Math.floor((NORMAL_H - targetH) / 2);
  const indices = [];
  for (let y = 0; y < targetH; y++) for (let x = 0; x < targetW; x++) {
    const sx = Math.min(box.w - 1, Math.floor(x * box.w / targetW));
    const sy = Math.min(box.h - 1, Math.floor(y * box.h / targetH));
    if (binary[(box.y + sy) * sourceWidth + box.x + sx]) indices.push((offsetY + y) * NORMAL_W + offsetX + x);
  }
  return indices;
}

function iou(a, b) {
  let ai = 0, bi = 0, intersection = 0;
  while (ai < a.length && bi < b.length) {
    if (a[ai] === b[bi]) { intersection++; ai++; bi++; }
    else if (a[ai] < b[bi]) ai++;
    else bi++;
  }
  return intersection / (a.length + b.length - intersection + 1e-6);
}

function classify(indices, bank) {
  const scores = [];
  for (const [digit, templates] of Object.entries(bank.digits)) {
    let best = -1;
    for (const template of templates) best = Math.max(best, iou(indices, template));
    if (best >= 0) scores.push([digit, best]);
  }
  scores.sort((a, b) => b[1] - a[1]);
  if (!scores.length) return { digit: '?', score: 0, margin: 0 };
  return { digit: scores[0][0], score: scores[0][1], margin: scores[0][1] - (scores[1]?.[1] || 0) };
}

function prefixPresent(glyphs) {
  for (let i = 0; i < glyphs.length - 2; i++) {
    const [a, b, c] = glyphs.slice(i, i + 3);
    if (Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y) > 4) continue;
    if (b.x - (a.x + a.w) > 5 || c.x - (b.x + b.w) > 5) continue;
    for (const d of glyphs.slice(i + 3)) {
      const gap = d.x - (c.x + c.w);
      if (gap < 3) continue;
      if (gap > 16) break;
      if (Math.abs(d.y - c.y) <= 4) return true;
    }
  }
  return false;
}

function decodedText(chars, layout) {
  return layout.decimal ? chars.slice(0, layout.nint).join('') + ',' + chars.slice(layout.nint).join('') : chars.join('');
}

export class PokerStarsCommitmentReader {
  constructor(bank) { this.bank = bank; this.profiles = bank.profiles || {}; }

  readImageData(image) {
    const startedAt = performance.now();
    const { layout, binary, glyphs } = commitmentLayout(image);
    if (!layout) return { value: null, text: '', visible: prefixPresent(glyphs), confidence: 0, latencyMs: performance.now() - startedAt };
    const classified = layout.boxes.map(box => ({ ...classify(normalizeBox(binary, image.width, box), this.bank), box }));
    let chars = classified.map(x => x.digit);
    const scores = classified.map(x => x.score), margins = classified.map(x => x.margin);
    const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
    let accepted = !chars.includes('?') && Math.min(...scores) >= .40 && mean >= .50 && Math.min(...margins) >= .01;
    if (!accepted) accepted = !chars.includes('?') && Math.min(...scores) >= .72 && mean >= .84 && Math.min(...margins) >= .003;
    chars = chars.map((char, i) => char === '1' && layout.boxes[i].w >= 7 ? '4' : char);
    const visible = prefixPresent(glyphs);
    if (!accepted && !layout.decimal && layout.boxes.length === 1) {
      const box = layout.boxes[0];
      if (box.w >= 7 && box.h >= 11 && box.ink >= 40 && visible) { chars = ['4']; accepted = true; }
    }
    const text = accepted ? decodedText(chars, layout) : '';
    return {
      value: accepted ? Number(text.replace(',', '.')) : null,
      text,
      visible,
      confidence: mean,
      boxes: layout.boxes,
      latencyMs: performance.now() - startedAt,
    };
  }

  readCanvas(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return this.readImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  readMoneyImageData(image, profile) {
    const startedAt = performance.now(), named = this.profiles?.[profile];
    if (!named?.digits) return { value: null, text: '', visible: false, confidence: 0, latencyMs: performance.now() - startedAt };
    const { layout, binary } = moneyLayout(image, profile), boxes = moneyBoxes(binary, image.width, image.height, layout);
    if (!layout || !boxes.length) return { value: null, text: '', visible: false, confidence: 0, latencyMs: performance.now() - startedAt };
    const classified = boxes.map(box => classify(normalizeBox(binary, image.width, box), named));
    const chars = classified.map(x => x.digit), scores = classified.map(x => x.score), margins = classified.map(x => x.margin);
    const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
    const accepted = !chars.includes('?') && Math.min(...scores) >= .40 && mean >= .50 && Math.min(...margins) >= .01;
    const text = accepted ? decodedText(chars, layout) : '';
    return { value: accepted ? Number(text.replace(',', '.')) : null, text, visible: true, confidence: mean, boxes, latencyMs: performance.now() - startedAt };
  }

  readMoneyCanvas(canvas, profile) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return this.readMoneyImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), profile);
  }
}

export const __private = { binaryFromImageData, components, commitmentLayout, moneyBinary, moneyLayout, moneyBoxes, normalizeBox, classify, iou };
