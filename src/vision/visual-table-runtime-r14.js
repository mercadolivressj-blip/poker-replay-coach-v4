import { activeHandMachine } from '../core/state-machine.js';
import { activeActionTimeline } from '../core/action-timeline.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';
import { detectFelt, stabilizeFelt } from '../core/geometry.js';
import { seatRectsFromFelt, parseSeatText, inferActionFromStacks, stableNumericObservation } from './pokerstars-table-reader-r14.js';

const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const SEAT_LABELS = ['HERO', 'DIR. BAIXO', 'DIR. CIMA', 'TOPO', 'ESQ. CIMA', 'ESQ. BAIXO'];

const diagnostics = {
  reads: 0,
  acceptedSnapshots: 0,
  appendedEvents: 0,
  lastMs: 0,
  lastError: null,
  handId: 0,
  street: null,
  seats: [],
};
if (typeof window !== 'undefined') window.__prcVisualTableR14 = diagnostics;

let workers = [];
let workerInit = null;
let busy = false;
let lastReadAt = 0;
let lastHandId = -1;
let lastStreet = null;
let felt = null;
let baselineReady = false;
let sourceEpoch = 0;
let seatMemory = Array.from({ length: 6 }, () => newSeatMemory());

function newSeatMemory() {
  return {
    actorName: null,
    pendingName: null,
    nameHits: 0,
    stackObs: { value: null, pending: null, hits: 0 },
    committed: 0,
    folded: false,
    occupied: false,
    lastRaw: '',
    lastActionKey: null,
  };
}

function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function actorKey(name) { return String(name || '').trim().toLowerCase(); }

function visibleSource() {
  const video = document.getElementById('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return video;
  const image = document.getElementById('image');
  if (image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0) return image;
  return null;
}

function sourceSize(source) {
  return {
    w: source?.videoWidth || source?.naturalWidth || source?.width || 0,
    h: source?.videoHeight || source?.naturalHeight || source?.height || 0,
  };
}

function snapshotSource(source, maxWidth = 1280) {
  const { w, h } = sourceSize(source);
  if (!w || !h) return null;
  const scale = Math.min(1, maxWidth / w);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(480, Math.round(w * scale));
  canvas.height = Math.max(270, Math.round(h * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function textRect(rect, seatIndex) {
  const r = { ...rect };
  if (seatIndex === 0) {
    r.x += r.w * 0.08; r.w *= 0.84; r.y += r.h * 0.22; r.h *= 0.76;
  } else if (seatIndex === 1 || seatIndex === 2) {
    r.x += r.w * 0.24; r.w *= 0.76; r.y += r.h * 0.12; r.h *= 0.82;
  } else {
    r.w *= 0.76; r.y += r.h * 0.12; r.h *= 0.82;
  }
  return r;
}

function cropNormalized(sourceCanvas, rect, targetWidth = 360) {
  const sx = Math.max(0, Math.round(rect.x * sourceCanvas.width));
  const sy = Math.max(0, Math.round(rect.y * sourceCanvas.height));
  const sw = Math.max(4, Math.min(sourceCanvas.width - sx, Math.round(rect.w * sourceCanvas.width)));
  const sh = Math.max(4, Math.min(sourceCanvas.height - sy, Math.round(rect.h * sourceCanvas.height)));
  const scale = targetWidth / Math.max(1, sw);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = Math.max(70, Math.min(180, Math.round(sh * scale)));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function highContrastText(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);
  const im = ctx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < im.data.length; i += 4) {
    const r = im.data[i], g = im.data[i + 1], b = im.data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const textLike = luma > 105 && !(g > r * 1.35 && g > b * 1.2 && spread > 45);
    const v = textLike ? 0 : 255;
    im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return out;
}

async function ensureTesseract() {
  if (window.Tesseract) return true;
  const existing = document.querySelector('script[data-prc-tesseract]');
  if (existing) {
    const start = Date.now();
    while (!window.Tesseract && Date.now() - start < 6500) await new Promise((r) => setTimeout(r, 60));
    return Boolean(window.Tesseract);
  }
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = TESSERACT_SRC;
    script.async = true;
    script.dataset.prcTesseract = '1';
    const timer = setTimeout(() => resolve(false), 7000);
    script.onload = () => { clearTimeout(timer); resolve(Boolean(window.Tesseract)); };
    script.onerror = () => { clearTimeout(timer); resolve(false); };
    document.head.appendChild(script);
  });
}

async function ensureWorkers() {
  if (workers.length) return true;
  if (workerInit) return workerInit;
  workerInit = (async () => {
    if (!(await ensureTesseract())) return false;
    try {
      for (let i = 0; i < 2; i++) {
        const worker = await window.Tesseract.createWorker('eng');
        await worker.setParameters({
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1',
        });
        workers.push({ worker, busy: false });
      }
      return true;
    } catch (error) {
      diagnostics.lastError = `ocr-init: ${error?.message || 'failed'}`;
      workers = [];
      return false;
    }
  })();
  return workerInit;
}

async function takeWorker(timeoutMs = 2500) {
  const start = now();
  while (now() - start < timeoutMs) {
    const slot = workers.find((item) => !item.busy);
    if (slot) { slot.busy = true; return slot; }
    await new Promise((r) => setTimeout(r, 8));
  }
  return null;
}

async function readSeat(canvas) {
  const slot = await takeWorker();
  if (!slot) return { text: '', confidence: 0, timeout: true };
  const t0 = now();
  try {
    const out = await Promise.race([
      slot.worker.recognize(canvas),
      new Promise((resolve) => setTimeout(() => resolve(null), 2400)),
    ]);
    if (!out) return { text: '', confidence: 0, timeout: true, ms: now() - t0 };
    return { text: String(out.data?.text || '').trim(), confidence: Number(out.data?.confidence) || 0, ms: now() - t0 };
  } catch (error) {
    return { text: '', confidence: 0, error: error?.message || 'ocr-failed', ms: now() - t0 };
  } finally {
    slot.busy = false;
  }
}

function updateName(mem, candidate) {
  const value = String(candidate || '').trim();
  if (!value) return mem.actorName;
  if (mem.actorName && actorKey(mem.actorName) === actorKey(value)) {
    mem.pendingName = null; mem.nameHits = 0; return mem.actorName;
  }
  if (mem.pendingName && actorKey(mem.pendingName) === actorKey(value)) mem.nameHits++;
  else { mem.pendingName = value; mem.nameHits = 1; }
  if (mem.nameHits >= 2) {
    mem.actorName = mem.pendingName;
    mem.pendingName = null;
    mem.nameHits = 0;
  }
  return mem.actorName;
}

function resetForHand(handId, street) {
  lastHandId = handId;
  lastStreet = street;
  seatMemory = Array.from({ length: 6 }, () => newSeatMemory());
  baselineReady = false;
  diagnostics.handId = handId;
  diagnostics.street = street;
  diagnostics.seats = [];
  sourceEpoch++;
}

function resetStreet(street) {
  lastStreet = street;
  for (const mem of seatMemory) mem.committed = 0;
  diagnostics.street = street;
}

function eventConfidence(ocrConfidence, parsed) {
  let evidence = 0;
  if (parsed.actorName) evidence += 0.34;
  if (Number.isFinite(parsed.stack)) evidence += 0.26;
  if (parsed.visibleAction) evidence += 0.40;
  return clamp((ocrConfidence / 100) * 0.62 + evidence * 0.38 + 0.12, 0.45, 0.96);
}

function appendTrackerEvents(events, handId) {
  let added = 0;
  for (const event of events || []) {
    if (activeActionTimeline?.append({
      handId,
      street: event.street,
      actorName: event.actorName,
      seatLabel: event.seatLabel,
      action: event.action,
      amount: Number.isFinite(event.amount) ? event.amount : null,
      source: event.source || 'visual-seat-r14',
      confidence: Number.isFinite(event.confidence) ? event.confidence : 0.62,
      observedAt: now(),
    })) added++;
  }
  diagnostics.appendedEvents += added;
}

function ensureReadout() {
  if (typeof document === 'undefined') return null;
  let box = document.getElementById('tableVisionR14');
  if (box) return box;
  const coach = document.querySelector('.coach-card');
  if (!coach) return null;
  box = document.createElement('div');
  box.id = 'tableVisionR14';
  box.className = 'table-vision-r14';
  box.innerHTML = '<span class="eyebrow">MESA VISUAL</span><strong id="tableVisionTitle">Lendo jogadores…</strong><div id="tableVisionRows"></div>';
  const actions = document.getElementById('actions');
  if (actions) actions.insertAdjacentElement('afterend', box); else coach.append(box);
  if (!document.getElementById('tableVisionR14Styles')) {
    const style = document.createElement('style');
    style.id = 'tableVisionR14Styles';
    style.textContent = '.table-vision-r14{margin-top:12px;border:1px solid #2b383d;border-radius:10px;background:#0b1113;padding:11px}.table-vision-r14>strong{display:block;margin-top:5px;font-size:13px}.table-vision-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:7px;padding-top:7px;border-top:1px solid #202b2f;font-size:11px}.table-vision-row span{color:#c7d1d4}.table-vision-row small{color:#7f8f95;text-align:right}.table-vision-row b{color:#63d49a;font-weight:800}.table-vision-row.warn b{color:#f2c44f}';
    document.head.appendChild(style);
  }
  return box;
}

function renderReadout(seats, events) {
  const box = ensureReadout();
  if (!box) return;
  const title = document.getElementById('tableVisionTitle');
  const rows = document.getElementById('tableVisionRows');
  if (!title || !rows) return;
  const active = seats.filter((seat) => seat && seat.confidence >= 0.5);
  title.textContent = active.length ? `${active.length} assentos rastreados · ${events.length} ações nesta mão` : 'Procurando assentos…';
  rows.replaceChildren();
  for (const seat of active) {
    const row = document.createElement('div');
    row.className = 'table-vision-row';
    const left = document.createElement('span');
    const name = seat.actorName || `Seat ${seat.seatIndex + 1}`;
    left.textContent = `${seat.hero ? 'VOCÊ · ' : ''}${name}${seat.position ? ` · ${seat.position}` : ''}`;
    const right = document.createElement('small');
    const last = [...events].reverse().find((e) => actorKey(e.actorName) === actorKey(seat.actorName) || (!e.actorName && e.seatLabel === seat.position));
    const stack = Number.isFinite(seat.stack) ? `stack ${Math.round(seat.stack * 100) / 100}` : 'stack ?';
    const action = last ? `${last.action.toUpperCase()}${Number.isFinite(last.amount) ? ` ${Math.round(last.amount * 100) / 100}` : ''}` : 'sem ação confirmada';
    right.innerHTML = `${stack} · <b>${action}</b>`;
    row.append(left, right);
    rows.append(row);
  }
}

async function readTableOnce() {
  const machine = activeHandMachine;
  const timeline = activeActionTimeline;
  const tracker = activeTableStateTracker;
  const source = visibleSource();
  if (!machine || !timeline || !tracker || !source || machine.handId <= 0 || busy) return;
  const t = now();
  if (t - lastReadAt < 520) return;
  lastReadAt = t;
  if (machine.handId !== lastHandId) resetForHand(machine.handId, machine.state.street);
  else if (machine.state.street !== lastStreet) resetStreet(machine.state.street);

  if (!(await ensureWorkers())) return;
  const epoch = sourceEpoch;
  const canvas = snapshotSource(source);
  if (!canvas) return;
  busy = true;
  const t0 = now();
  try {
    const nextFelt = detectFelt({ canvas, w: canvas.width, h: canvas.height });
    if (!nextFelt) {
      diagnostics.lastError = 'felt-not-found';
      return;
    }
    felt = stabilizeFelt(felt, nextFelt);
    const rects = seatRectsFromFelt(felt);
    const crops = rects.map((rect, i) => highContrastText(cropNormalized(canvas, textRect(rect, i))));
    const reads = await Promise.all(crops.map(readSeat));
    if (epoch !== sourceEpoch || activeHandMachine?.handId !== machine.handId) return;

    const parsed = reads.map((read) => parseSeatText(read.text));
    const previousMaxCommitted = Math.max(0, ...seatMemory.map((mem) => Number(mem.committed) || 0));
    const seats = [];

    for (let i = 0; i < 6; i++) {
      const mem = seatMemory[i];
      const p = parsed[i];
      const read = reads[i];
      mem.lastRaw = p.raw;
      if (p.empty) {
        mem.occupied = false;
        continue;
      }

      const actorName = updateName(mem, p.actorName) || mem.actorName || (p.occupied ? `Seat ${i + 1}` : null);
      const stackUpdate = stableNumericObservation(mem.stackObs, p.stack, { tolerance: 0.02, hits: 2 });
      mem.stackObs = stackUpdate.memory;
      const previousStack = mem.stackObs.value;
      let inferred = null;

      if (stackUpdate.accepted && baselineReady && Number.isFinite(previousStack) && Number.isFinite(stackUpdate.value)) {
        // stableNumericObservation has already moved memory.value to the new value;
        // the prior accepted value is kept below using the explicit snapshot copy.
      }

      const priorStable = Number.isFinite(mem.__priorStack) ? mem.__priorStack : null;
      if (stackUpdate.accepted) {
        if (baselineReady && Number.isFinite(priorStable)) {
          inferred = inferActionFromStacks({
            previousStack: priorStable,
            currentStack: stackUpdate.value,
            previousCommitted: mem.committed,
            maxCommitted: previousMaxCommitted,
            epsilon: Math.max(0.75, Math.abs(priorStable) * 0.0015),
          });
          if (inferred?.committed >= 0) mem.committed = inferred.committed;
        }
        mem.__priorStack = stackUpdate.value;
      } else if (!Number.isFinite(mem.__priorStack) && Number.isFinite(stackUpdate.value)) {
        mem.__priorStack = stackUpdate.value;
      }

      let visibleAction = p.visibleAction || inferred?.action || null;
      let visibleActionAmount = Number.isFinite(p.visibleActionAmount) ? p.visibleActionAmount : (Number.isFinite(inferred?.amount) ? inferred.amount : null);
      if (p.visibleAction === 'allin' && !Number.isFinite(p.stack) && Number.isFinite(mem.__priorStack)) {
        visibleAction = 'allin';
        visibleActionAmount = Number.isFinite(visibleActionAmount) ? visibleActionAmount : mem.__priorStack;
      }
      if (visibleAction === 'fold') mem.folded = true;
      else if (visibleAction && visibleAction !== 'fold') mem.folded = false;
      mem.occupied = Boolean(p.occupied || actorName || Number.isFinite(mem.__priorStack) || visibleAction);
      if (!mem.occupied) continue;

      const conf = eventConfidence(read.confidence || 0, { ...p, actorName, stack: mem.__priorStack, visibleAction });
      seats.push({
        seatIndex: i,
        actorName,
        stack: Number.isFinite(mem.__priorStack) ? mem.__priorStack : null,
        committed: Number.isFinite(mem.committed) ? mem.committed : 0,
        dealer: false,
        folded: mem.folded,
        hero: i === 0,
        visibleAction,
        visibleActionAmount,
        confidence: conf,
      });
    }

    if (!baselineReady && seats.filter((seat) => Number.isFinite(seat.stack) || seat.visibleAction).length >= 2) baselineReady = true;
    const snapshot = {
      handId: machine.handId,
      street: machine.state.street,
      confidence: seats.length ? seats.reduce((sum, seat) => sum + seat.confidence, 0) / seats.length : 0,
      seats,
    };
    const result = tracker.ingest(snapshot);
    if (result.accepted) {
      diagnostics.acceptedSnapshots++;
      appendTrackerEvents(result.events, machine.handId);
    }

    diagnostics.reads++;
    diagnostics.lastMs = now() - t0;
    diagnostics.lastError = reads.some((r) => r.error) ? 'seat-ocr-partial' : null;
    diagnostics.seats = seats.map((seat) => ({ ...seat }));
    renderReadout(result.state?.seats || seats, timeline.events || []);
  } catch (error) {
    diagnostics.lastError = error?.message || 'visual-table-failed';
  } finally {
    diagnostics.lastMs = now() - t0;
    busy = false;
  }
}

function tick() {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => void readTableOnce(), { timeout: 220 });
  else void readTableOnce();
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', () => {
    const machine = activeHandMachine;
    if (machine) resetForHand(machine.handId, machine.state.street);
  });
  setInterval(tick, 250);
  setTimeout(tick, 600);
}
