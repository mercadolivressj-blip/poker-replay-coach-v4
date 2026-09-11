import { activeHandMachine } from '../core/state-machine.js';
import { activeActionTimeline } from '../core/action-timeline.js';
import { parseDealerActionLine } from './local-action-parser.js';

const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let worker = null;
let loading = null;
let busy = false;
let lastReadAt = 0;
let lastHandId = 0;

export const localActionDiagnostics = { reads: 0, appended: 0, lastMs: 0, lastText: '', lastError: null };
if (typeof window !== 'undefined') window.__prcLocalActionDiagnostics = localActionDiagnostics;

function visibleSource() {
  const video = document.getElementById('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return video;
  const image = document.getElementById('image');
  if (image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0) return image;
  return null;
}

function cropChat(source) {
  const sw = source.videoWidth || source.naturalWidth || source.width || 0;
  const sh = source.videoHeight || source.naturalHeight || source.height || 0;
  if (!sw || !sh) return null;
  const sx = Math.round(sw * 0.005), sy = Math.round(sh * 0.755), cw = Math.round(sw * 0.49), ch = Math.round(sh * 0.235);
  const scale = Math.min(1.35, 760 / Math.max(1, cw));
  const c = document.createElement('canvas');
  c.width = Math.max(420, Math.round(cw * scale));
  c.height = Math.max(130, Math.round(ch * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, sx, sy, cw, ch, 0, 0, c.width, c.height);
  return c;
}

async function ensureTesseract() {
  if (window.Tesseract) return true;
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const existing = document.querySelector('script[data-prc-tesseract]');
    if (existing) {
      const wait = setInterval(() => { if (window.Tesseract) { clearInterval(wait); resolve(true); } }, 60);
      setTimeout(() => { clearInterval(wait); resolve(Boolean(window.Tesseract)); }, 5000);
      return;
    }
    const script = document.createElement('script');
    script.src = TESSERACT_SRC;
    script.async = true;
    script.dataset.prcTesseract = '1';
    script.onload = () => resolve(Boolean(window.Tesseract));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return loading;
}

async function ensureWorker() {
  if (worker) return worker;
  if (!(await ensureTesseract())) return null;
  try {
    worker = await window.Tesseract.createWorker('eng');
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    return worker;
  } catch (e) {
    localActionDiagnostics.lastError = `worker: ${e?.message || 'failed'}`;
    worker = null;
    return null;
  }
}

async function readOnce() {
  const machine = activeHandMachine;
  const timeline = activeActionTimeline;
  const source = visibleSource();
  if (!machine || !timeline || !source || machine.handId <= 0 || timeline.handId !== machine.handId || busy) return;
  const now = performance.now();
  if (now - lastReadAt < 850) return;
  lastReadAt = now;
  if (lastHandId !== machine.handId) { lastHandId = machine.handId; localActionDiagnostics.lastText = ''; }

  const canvas = cropChat(source);
  if (!canvas) return;
  busy = true;
  const handId = machine.handId;
  const street = machine.state.street;
  const t0 = performance.now();
  try {
    const w = await ensureWorker();
    if (!w) return;
    const out = await w.recognize(canvas);
    if (activeHandMachine?.handId !== handId || activeActionTimeline?.handId !== handId) return;
    const data = out?.data || {};
    const text = String(data.text || '').trim();
    localActionDiagnostics.reads++;
    localActionDiagnostics.lastMs = performance.now() - t0;
    localActionDiagnostics.lastText = text.slice(-500);
    localActionDiagnostics.lastError = null;
    const baseConfidence = Math.max(0.58, Math.min(0.92, (Number(data.confidence) || 55) / 100));

    for (const line of text.split(/\r?\n/)) {
      const event = parseDealerActionLine(line);
      if (!event) continue;
      if (activeActionTimeline.append({
        handId,
        street,
        actorName: event.actorName,
        seatLabel: null,
        action: event.action,
        amount: event.amount,
        source: 'local-dealer-chat',
        confidence: baseConfidence,
        observedAt: performance.now(),
      })) localActionDiagnostics.appended++;
    }
  } catch (e) {
    localActionDiagnostics.lastError = e?.message || 'ocr-failed';
  } finally {
    localActionDiagnostics.lastMs = performance.now() - t0;
    busy = false;
  }
}

function tick() {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void readOnce(), { timeout: 500 });
  else void readOnce();
}

setInterval(tick, 450);
setTimeout(tick, 900);
