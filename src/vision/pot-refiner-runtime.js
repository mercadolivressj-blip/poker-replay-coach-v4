import { activeHandMachine } from '../core/state-machine.js';
import { detectFelt, layoutFromFelt, stabilizeFelt } from '../core/geometry.js';
import { cropCanvas } from '../core/image.js';
import { OcrService } from '../core/ocr.js';
import { findPotPill, potCrop, PotConsensus } from '../detectors/pot.js';

const diagnostics = {
  reads: 0,
  commits: 0,
  raw: null,
  confirmed: null,
  lastMs: 0,
  lastError: null,
};
if (typeof window !== 'undefined') window.__prcPotRefinerDiagnostics = diagnostics;

const ocr = new OcrService();
void ocr.prewarmDigits();
const consensus = new PotConsensus();
const capture = document.createElement('canvas');
const scratch = document.createElement('canvas');
let felt = null;
let layout = null;
let lastGeomAt = 0;
let lastHandId = 0;
let busy = false;
let lastReadAt = 0;

function visibleSource() {
  const video = document.getElementById('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return video;
  const image = document.getElementById('image');
  if (image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0) return image;
  return null;
}

function captureFrame(source) {
  const sw = source.videoWidth || source.naturalWidth || source.width || 0;
  const sh = source.videoHeight || source.naturalHeight || source.height || 0;
  if (!sw || !sh) return null;
  const scale = Math.min(1, 900 / sw);
  capture.width = Math.max(320, Math.round(sw * scale));
  capture.height = Math.max(180, Math.round(sh * scale));
  const ctx = capture.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, capture.width, capture.height);
  return { canvas: capture, w: capture.width, h: capture.height };
}

function paintConfirmed(value) {
  const pot = document.getElementById('potValue');
  if (pot && Number.isFinite(value)) pot.textContent = Intl.NumberFormat('pt-BR').format(Math.round(value));
  const diag = document.getElementById('dPot');
  if (diag && Number.isFinite(value)) diag.textContent = `${Math.round(value)} · refiner`;
}

function acceptCandidate(machine, handId, value) {
  if (!Number.isFinite(value) || value <= 1 || machine.handId !== handId) return false;
  const current = Number.isFinite(machine.state.pot) ? machine.state.pot : null;
  // During a hand the pot cannot materially shrink. Hand lifecycle owns resets;
  // this refiner only fixes stale/missed increases.
  if (current !== null && value < current * 0.72) return false;
  const stable = consensus.observe(value);
  if (stable === null) return false;
  if (current !== null && stable < current) return false;
  machine.setPot(stable, handId);
  diagnostics.confirmed = stable;
  diagnostics.commits++;
  paintConfirmed(stable);
  return true;
}

async function readOnce() {
  const machine = activeHandMachine;
  const source = visibleSource();
  if (!machine || machine.handId <= 0 || !source || busy) return;
  const now = performance.now();
  if (now - lastReadAt < 220) return;
  lastReadAt = now;

  if (machine.handId !== lastHandId) {
    lastHandId = machine.handId;
    consensus.reset();
    felt = null;
    layout = null;
  }

  const frame = captureFrame(source);
  if (!frame) return;
  busy = true;
  const t0 = performance.now();
  const handId = machine.handId;
  try {
    if (!layout || now - lastGeomAt > 700) {
      const next = detectFelt(frame);
      if (next) {
        felt = stabilizeFelt(felt, next);
        layout = layoutFromFelt(felt);
        lastGeomAt = now;
      }
    }
    if (!layout) return;

    const zone = cropCanvas(frame.canvas, layout.pot, 300, scratch);
    const pill = findPotPill(zone.data, zone.w, zone.h);
    let read = null;
    if (pill) read = await ocr.readNumber(potCrop(zone.canvas, pill), 'pot');

    // If the tight pill read fails, the geometry itself is already narrowly
    // centered on the PokerStars pot label. OCR the whole zone as a fallback.
    if (!Number.isFinite(read?.value)) {
      read = await ocr.readNumber(potCrop(zone.canvas, null), 'pot');
    }

    if (machine.handId !== handId || !Number.isFinite(read?.value)) return;
    diagnostics.raw = read.value;
    diagnostics.reads++;
    acceptCandidate(machine, handId, read.value);
    diagnostics.lastError = null;
  } catch (error) {
    diagnostics.lastError = error?.message || 'pot-refiner-failed';
  } finally {
    diagnostics.lastMs = performance.now() - t0;
    busy = false;
  }
}

setInterval(() => void readOnce(), 110);
setTimeout(() => void readOnce(), 160);
