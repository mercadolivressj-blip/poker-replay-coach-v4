const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let tesseractLoader = null;
let tesseractLastFailureAt = 0;
const TESSERACT_RETRY_MS = 5000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureTesseract(timeoutMs = 7000) {
  if (typeof window === 'undefined') return false;
  if (window.Tesseract) return true;
  if (tesseractLoader) {
    if (tesseractLastFailureAt && Date.now() - tesseractLastFailureAt >= TESSERACT_RETRY_MS) {
      tesseractLoader = null;
      document.querySelector('script[data-prc-tesseract]')?.remove();
    } else return tesseractLoader;
  }
  tesseractLoader = new Promise((resolve) => {
    const existing = document.querySelector('script[data-prc-tesseract]');
    const script = existing || document.createElement('script');
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const success = Boolean(ok && window.Tesseract);
      tesseractLastFailureAt = success ? 0 : Date.now();
      resolve(success);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    script.addEventListener('load', () => finish(true), { once: true });
    script.addEventListener('error', () => finish(false), { once: true });
    if (!existing) {
      script.src = TESSERACT_SRC;
      script.async = true;
      script.dataset.prcTesseract = '1';
      document.head.appendChild(script);
    }
  });
  return tesseractLoader;
}

export function parseRankText(text) {
  const s = String(text || '')
    .toUpperCase()
    .replace(/\s/g, '');
  const matches = [...s.matchAll(/10|[2-9TJQKA]/g)].map((m) => (m[0] === '10' ? 'T' : m[0]));
  if (!matches.length) return null;
  return matches[0];
}

export function parseNumberText(text) {
  let s = String(text || '')
    .replace(/\s/g, '')
    .replace(/[^0-9.,]/g, '')
    .replace(/^[.,]+|[.,]+$/g, '');
  if (!s || !/\d/.test(s)) return null;
  const groups = s.split(/[.,]/);
  if (groups.length > 1 && groups.slice(1).every((g) => /^\d{3}$/.test(g))) {
    const n = Number(groups.join(''));
    return Number.isFinite(n) ? n : null;
  }
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (lastSep > 0) {
    const tail = s.slice(lastSep + 1);
    if (/^\d{1,2}$/.test(tail)) {
      const whole = s.slice(0, lastSep).replace(/[.,]/g, '');
      const n = Number(`${whole}.${tail}`);
      return Number.isFinite(n) ? n : null;
    }
  }
  const n = Number(s.replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function binaryCanvas(source, mode, threshold, scale = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(source.width * scale));
  c.height = Math.max(8, Math.round(source.height * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const im = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < im.data.length; i += 4) {
    const L = 0.299 * im.data[i] + 0.587 * im.data[i + 1] + 0.114 * im.data[i + 2];
    const black = mode === 'dark' ? L < threshold : L > threshold;
    const v = black ? 0 : 255;
    im.data[i] = v;
    im.data[i + 1] = v;
    im.data[i + 2] = v;
    im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

class Pool {
  constructor(size, whitelist, psm = '7') {
    this.size = size;
    this.whitelist = whitelist;
    this.psm = psm;
    this.workers = [];
    this.failed = false;
    this.failedAt = 0;
    this.ready = null;
  }

  ensureReady() {
    if (this.failed && Date.now() - this.failedAt >= TESSERACT_RETRY_MS) {
      this.failed = false;
      this.failedAt = 0;
      this.ready = null;
      this.workers = [];
    }
    if (!this.ready) this.ready = this.init();
    return this.ready;
  }

  async init() {
    const available = await ensureTesseract();
    if (!available) {
      this.failed = true;
      this.failedAt = Date.now();
      return;
    }
    try {
      for (let i = 0; i < this.size; i++) {
        const w = await window.Tesseract.createWorker('eng');
        await w.setParameters({
          tessedit_char_whitelist: this.whitelist,
          tessedit_pageseg_mode: this.psm,
          preserve_interword_spaces: '1',
        });
        this.workers.push({ w, busy: false });
      }
    } catch {
      this.failed = true;
      this.failedAt = Date.now();
    }
  }

  async recognize(canvas, timeoutMs = 1800) {
    await this.ensureReady();
    if (this.failed || !this.workers.length) return { text: '', confidence: 0, ms: 0, unavailable: true };
    const slot = await this.take(timeoutMs);
    if (!slot) return { text: '', confidence: 0, ms: timeoutMs, timeout: true };
    slot.busy = true;
    try {
      const t0 = performance.now();
      const out = await Promise.race([slot.w.recognize(canvas), sleep(timeoutMs).then(() => null)]);
      if (!out) return { text: '', confidence: 0, ms: performance.now() - t0, timeout: true };
      const data = out.data || {};
      return { text: (data.text || '').trim(), confidence: data.confidence || 0, ms: performance.now() - t0 };
    } catch {
      return { text: '', confidence: 0, ms: 0, error: true };
    } finally {
      slot.busy = false;
    }
  }

  async take(timeoutMs) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const s = this.workers.find((x) => !x.busy);
      if (s) return s;
      await sleep(4);
    }
    return null;
  }
}

export class OcrService {
  constructor() {
    this.rankHero = new Pool(1, '23456789TJQKA10', '10');
    this.rankBoard = new Pool(1, '23456789TJQKA10', '10');
    this.potDigits = new Pool(1, '0123456789.,', '7');
    this.actionDigits = new Pool(2, '0123456789.,', '7');
  }

  prewarm() {
    return Promise.allSettled([
      this.rankHero.ensureReady(),
      this.rankBoard.ensureReady(),
      this.potDigits.ensureReady(),
      this.actionDigits.ensureReady(),
    ]);
  }

  prewarmDigits() {
    return Promise.allSettled([this.potDigits.ensureReady(), this.actionDigits.ensureReady()]);
  }

  async readRank(canvas, lane = 'hero') {
    const pool = lane === 'board' ? this.rankBoard : this.rankHero;
    const raw = await pool.recognize(canvas, 900);
    const rawValue = parseRankText(raw.text);
    if (rawValue && (raw.confidence || 0) >= 72)
      return { ...raw, value: rawValue, agreement: 1 };

    const variants = [binaryCanvas(canvas, 'dark', 165), binaryCanvas(canvas, 'dark', 190)];
    const reads = [];
    for (const v of variants) reads.push(await pool.recognize(v, 900));
    const parsed = [raw, ...reads]
      .map((r) => ({ ...r, value: parseRankText(r.text) }))
      .filter((r) => r.value);
    if (!parsed.length)
      return {
        text: [raw, ...reads].map((r) => r.text).filter(Boolean).join(' | '),
        confidence: Math.max(0, raw.confidence || 0, ...reads.map((r) => r.confidence || 0)),
        ms: Math.max(0, raw.ms || 0, ...reads.map((r) => r.ms || 0)),
        value: null,
        agreement: 0,
      };
    const counts = new Map();
    for (const r of parsed) counts.set(r.value, (counts.get(r.value) || 0) + 1);
    parsed.sort((a, b) => {
      const ca = counts.get(a.value) || 0;
      const cb = counts.get(b.value) || 0;
      return cb - ca || b.confidence - a.confidence;
    });
    const best = parsed[0];
    return {
      text: [raw, ...reads].map((r) => r.text).filter(Boolean).join(' | '),
      confidence: Math.max(0, raw.confidence || 0, ...reads.map((r) => r.confidence || 0)),
      ms: Math.max(0, raw.ms || 0, ...reads.map((r) => r.ms || 0)),
      value: best.value,
      agreement: counts.get(best.value) || 1,
    };
  }

  async readNumber(canvas, lane = 'pot') {
    const pool = lane === 'action' ? this.actionDigits : this.potDigits;
    const raw = await pool.recognize(canvas, lane === 'action' ? 750 : 900);
    const rawValue = parseNumberText(raw.text);
    if (Number.isFinite(rawValue) && (raw.confidence || 0) >= 62)
      return { ...raw, value: rawValue, agreement: 1 };

    const variants = [binaryCanvas(canvas, 'light', 150), binaryCanvas(canvas, 'light', 180)];
    const reads = [];
    for (const v of variants) reads.push(await pool.recognize(v, lane === 'action' ? 750 : 900));
    const parsed = [raw, ...reads]
      .map((r) => ({ ...r, value: parseNumberText(r.text) }))
      .filter((r) => Number.isFinite(r.value));
    if (!parsed.length)
      return {
        text: [raw, ...reads].map((r) => r.text).filter(Boolean).join(' | '),
        confidence: Math.max(0, raw.confidence || 0, ...reads.map((r) => r.confidence || 0)),
        ms: Math.max(0, raw.ms || 0, ...reads.map((r) => r.ms || 0)),
        value: null,
        agreement: 0,
      };
    const rounded = parsed.map((r) => ({ ...r, key: String(Math.round(r.value)) }));
    const counts = new Map();
    for (const r of rounded) counts.set(r.key, (counts.get(r.key) || 0) + 1);
    rounded.sort((a, b) => {
      const ca = counts.get(a.key) || 0;
      const cb = counts.get(b.key) || 0;
      return cb - ca || b.confidence - a.confidence;
    });
    const best = rounded[0];
    return {
      text: [raw, ...reads].map((r) => r.text).filter(Boolean).join(' | '),
      confidence: Math.max(0, raw.confidence || 0, ...reads.map((r) => r.confidence || 0)),
      ms: Math.max(0, raw.ms || 0, ...reads.map((r) => r.ms || 0)),
      value: best.value,
      agreement: counts.get(best.key) || 1,
    };
  }
}
