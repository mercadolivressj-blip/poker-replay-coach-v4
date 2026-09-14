import { activeHandMachine } from '../core/state-machine.js';
import { detectFelt, stabilizeFelt } from '../core/geometry.js';
import { parsePokerStarsNumber } from './pokerstars-table-reader-r14.js';

const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const diagnostics = {
  handId: 0,
  trusted: false,
  value: null,
  pending: null,
  hits: 0,
  reads: 0,
  manual: false,
  lastText: '',
  lastError: null,
};
if (typeof window !== 'undefined') window.__prcPotTrustR14 = diagnostics;

let worker = null;
let loading = null;
let busy = false;
let felt = null;
let lastReadAt = 0;
let lastHandId = -1;

function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function visibleSource() {
  const video = document.getElementById('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return video;
  const image = document.getElementById('image');
  if (image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0) return image;
  return null;
}
function snapshot(source, maxWidth = 1000) {
  const sw = source?.videoWidth || source?.naturalWidth || source?.width || 0;
  const sh = source?.videoHeight || source?.naturalHeight || source?.height || 0;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxWidth / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(500, Math.round(sw * scale)); c.height = Math.max(280, Math.round(sh * scale));
  c.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, c.width, c.height);
  return c;
}
function potRect(f) {
  return {
    x: Math.max(0, f.x + f.w * 0.34),
    y: Math.max(0, f.y + f.h * 0.10),
    w: Math.min(1, f.w * 0.32),
    h: Math.min(1, f.h * 0.16),
  };
}
function crop(source, rect, width = 480) {
  const sx = Math.max(0, Math.round(rect.x * source.width));
  const sy = Math.max(0, Math.round(rect.y * source.height));
  const sw = Math.max(4, Math.min(source.width - sx, Math.round(rect.w * source.width)));
  const sh = Math.max(4, Math.min(source.height - sy, Math.round(rect.h * source.height)));
  const scale = width / Math.max(1, sw);
  const c = document.createElement('canvas'); c.width = width; c.height = Math.max(55, Math.round(sh * scale));
  c.getContext('2d', { willReadFrequently: true }).drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
function thresholdCanvas(source, threshold) {
  const c = document.createElement('canvas'); c.width = source.width; c.height = source.height;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(source, 0, 0);
  const im = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < im.data.length; i += 4) {
    const L = 0.299 * im.data[i] + 0.587 * im.data[i + 1] + 0.114 * im.data[i + 2];
    const v = L > threshold ? 0 : 255;
    im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0); return c;
}
async function ensureWorker() {
  if (worker) return worker;
  if (loading) return loading;
  loading = (async () => {
    if (!window.Tesseract) {
      await new Promise((resolve) => {
        const existing = document.querySelector('script[data-prc-tesseract]');
        if (existing) {
          const start = Date.now(); const timer = setInterval(() => {
            if (window.Tesseract || Date.now() - start > 6500) { clearInterval(timer); resolve(); }
          }, 60); return;
        }
        const s = document.createElement('script'); s.src = TESSERACT_SRC; s.async = true; s.dataset.prcTesseract = '1';
        s.onload = resolve; s.onerror = resolve; document.head.appendChild(s);
      });
    }
    if (!window.Tesseract) return null;
    try {
      worker = await window.Tesseract.createWorker('eng');
      await worker.setParameters({ tessedit_pageseg_mode: '7', preserve_interword_spaces: '1' });
      return worker;
    } catch { return null; }
  })();
  return loading;
}
function valuesFromText(text) {
  return [...String(text || '').matchAll(/([0-9]+(?:[.,][0-9]+)?)/g)]
    .map((m) => parsePokerStarsNumber(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
}
function chooseAgreement(reads) {
  const values = reads.flatMap((r) => valuesFromText(r.text));
  if (!values.length) return null;
  for (let i = 0; i < values.length; i++) {
    const group = values.filter((v) => Math.abs(v - values[i]) <= Math.max(0.005, values[i] * 0.015));
    if (group.length >= 2) return group.reduce((a, b) => a + b, 0) / group.length;
  }
  return null;
}
function commitCandidate(value) {
  if (!Number.isFinite(value) || value <= 0) return;
  const closePending = Number.isFinite(diagnostics.pending) && Math.abs(value - diagnostics.pending) <= Math.max(0.005, value * 0.012);
  if (closePending) diagnostics.hits++;
  else { diagnostics.pending = value; diagnostics.hits = 1; }
  if (diagnostics.hits < 2) return;
  diagnostics.value = Math.round(value * 1000) / 1000;
  diagnostics.trusted = true;
  diagnostics.manual = false;
  const machine = activeHandMachine;
  if (machine && machine.handId === diagnostics.handId) {
    const current = Number(machine.state?.pot);
    if (!Number.isFinite(current) || Math.abs(current - diagnostics.value) > Math.max(0.005, diagnostics.value * 0.015)) {
      machine.setPot(diagnostics.value, machine.handId, { now: now() });
    }
  }
}
function reset(handId) {
  diagnostics.handId = handId; diagnostics.trusted = false; diagnostics.value = null; diagnostics.pending = null; diagnostics.hits = 0; diagnostics.manual = false; diagnostics.lastText = ''; diagnostics.lastError = null;
}
async function readOnce() {
  const machine = activeHandMachine; const source = visibleSource();
  if (!machine || !source || machine.handId <= 0 || busy) return;
  if (machine.handId !== lastHandId) { lastHandId = machine.handId; reset(machine.handId); }
  if (diagnostics.manual && diagnostics.trusted) return;
  const t = now(); if (t - lastReadAt < 520) return; lastReadAt = t;
  const w = await ensureWorker(); if (!w) { diagnostics.lastError = 'ocr-unavailable'; return; }
  const frame = snapshot(source); if (!frame) return; busy = true;
  try {
    const next = detectFelt({ canvas: frame, w: frame.width, h: frame.height });
    if (!next) { diagnostics.lastError = 'felt-not-found'; diagnostics.trusted = false; return; }
    felt = stabilizeFelt(felt, next);
    const raw = crop(frame, potRect(felt));
    const variants = [raw, thresholdCanvas(raw, 145), thresholdCanvas(raw, 180)];
    const reads = [];
    for (const v of variants) {
      const out = await Promise.race([w.recognize(v), new Promise((r) => setTimeout(() => r(null), 1300))]);
      reads.push({ text: String(out?.data?.text || '').trim(), confidence: Number(out?.data?.confidence) || 0 });
    }
    diagnostics.reads++;
    diagnostics.lastText = reads.map((r) => r.text).filter(Boolean).join(' | ').slice(0, 180);
    const agreed = chooseAgreement(reads.filter((r) => r.confidence >= 30));
    if (agreed !== null) commitCandidate(agreed);
    else if (diagnostics.hits > 0) diagnostics.hits--;
    diagnostics.lastError = null;
  } catch (e) { diagnostics.lastError = e?.message || 'pot-validation-error'; diagnostics.trusted = false; }
  finally { busy = false; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', (e) => { lastHandId = Number(e.detail?.generation) || activeHandMachine?.handId || 0; reset(lastHandId); });
  window.addEventListener('prc:manual-state-applied', (e) => {
    if (!e.detail?.pot || !activeHandMachine) return;
    diagnostics.handId = activeHandMachine.handId;
    diagnostics.value = Number(activeHandMachine.state?.pot) || null;
    diagnostics.pending = diagnostics.value;
    diagnostics.hits = 2;
    diagnostics.trusted = Number.isFinite(diagnostics.value) && diagnostics.value > 0;
    diagnostics.manual = diagnostics.trusted;
  });
}
setInterval(() => void readOnce(), 300);
setTimeout(() => void readOnce(), 800);
