import { activeHandMachine } from '../core/state-machine.js';
import { activeActionTimeline } from '../core/action-timeline.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';
import { detectFelt, stabilizeFelt } from '../core/geometry.js';
import { inferPokerStarsTableSize, parseSeatText, parsePokerStarsNumber, seatRectsFromFelt, stableNumericObservation } from './pokerstars-table-reader-r14.js';

const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const diagnostics = {
  version: 'r14b-adaptive',
  reads: 0,
  handId: 0,
  tableSize: null,
  expectedSeats: 0,
  trackedSeats: 0,
  activeSeats: 0,
  stableFrames: 0,
  trusted: false,
  trustReason: 'Inicializando leitura da mesa.',
  layoutScore6: 0,
  layoutScore9: 0,
  titleText: '',
  seats: [],
  lastError: null,
  lastMs: 0,
};
if (typeof window !== 'undefined') window.__prcVisualTableR14 = diagnostics;

let workers = [];
let digitsWorker = null;
let workerInit = null;
let busy = false;
let lastReadAt = 0;
let lastHandId = -1;
let lastStreet = null;
let sourceEpoch = 0;
let felt = null;
let tableSize = null;
let tableSizeVotes = { 6: 0, 9: 0 };
let seatMemory = [];
let lastSignature = '';

function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function actorKey(name) { return String(name || '').trim().toLowerCase(); }
function newSeatMemory() {
  return {
    actorName: null,
    pendingName: null,
    nameHits: 0,
    stackObs: { value: null, pending: null, hits: 0 },
    committedObs: { value: 0, pending: null, hits: 0 },
    folded: false,
    away: false,
    empty: false,
    lastRaw: '',
  };
}

function visibleSource() {
  const video = document.getElementById('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return video;
  const image = document.getElementById('image');
  if (image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0) return image;
  return null;
}

function snapshotSource(source, maxWidth = 1280) {
  const sw = source?.videoWidth || source?.naturalWidth || source?.width || 0;
  const sh = source?.videoHeight || source?.naturalHeight || source?.height || 0;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxWidth / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(520, Math.round(sw * scale));
  c.height = Math.max(300, Math.round(sh * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function cropNormalized(source, rect, targetWidth = 300) {
  const sx = Math.max(0, Math.round(rect.x * source.width));
  const sy = Math.max(0, Math.round(rect.y * source.height));
  const sw = Math.max(4, Math.min(source.width - sx, Math.round(rect.w * source.width)));
  const sh = Math.max(4, Math.min(source.height - sy, Math.round(rect.h * source.height)));
  const scale = targetWidth / Math.max(1, sw);
  const c = document.createElement('canvas');
  c.width = targetWidth;
  c.height = Math.max(52, Math.min(150, Math.round(sh * scale)));
  c.getContext('2d', { willReadFrequently: true }).drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function highContrast(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0);
  const im = ctx.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < im.data.length; i += 4) {
    const r = im.data[i], g = im.data[i + 1], b = im.data[i + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    const green = g > r * 1.30 && g > b * 1.18;
    const v = L > 104 && !green ? 0 : 255;
    im.data[i] = v; im.data[i + 1] = v; im.data[i + 2] = v; im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  return out;
}

function panelSignal(source, rect) {
  const sx = Math.max(0, Math.floor(rect.x * source.width));
  const sy = Math.max(0, Math.floor(rect.y * source.height));
  const sw = Math.max(2, Math.min(source.width - sx, Math.floor(rect.w * source.width)));
  const sh = Math.max(2, Math.min(source.height - sy, Math.floor(rect.h * source.height)));
  if (sw < 2 || sh < 2) return 0;
  const c = document.createElement('canvas');
  c.width = Math.min(150, sw); c.height = Math.min(80, sh);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let bright = 0, dark = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    if (L > 115 && !(g > r * 1.35 && g > b * 1.15)) bright++;
    if (L < 65) dark++;
    n++;
  }
  return n ? clamp(bright / n * 5 + dark / n * 0.25, 0, 1) : 0;
}

function scoreLayout(source, rects) {
  const scores = rects.map((r) => panelSignal(source, r));
  const hits = scores.filter((x) => x >= 0.10).length;
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length);
  return { score: hits / Math.max(1, scores.length) * 0.78 + mean * 0.22, hits, scores };
}

function commitmentRect(seatRect, feltRect) {
  const sx = seatRect.x + seatRect.w / 2;
  const sy = seatRect.y + seatRect.h / 2;
  const cx = feltRect.x + feltRect.w / 2;
  const cy = feltRect.y + feltRect.h / 2;
  const t = 0.37;
  const px = sx + (cx - sx) * t;
  const py = sy + (cy - sy) * t;
  const w = feltRect.w * 0.20;
  const h = feltRect.h * 0.13;
  return { x: clamp(px - w / 2, 0, 0.98), y: clamp(py - h / 2, 0, 0.98), w: Math.min(w, 1 - clamp(px - w / 2, 0, 0.98)), h: Math.min(h, 1 - clamp(py - h / 2, 0, 0.98)) };
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
    const s = document.createElement('script');
    s.src = TESSERACT_SRC; s.async = true; s.dataset.prcTesseract = '1';
    const timer = setTimeout(() => resolve(false), 7000);
    s.onload = () => { clearTimeout(timer); resolve(Boolean(window.Tesseract)); };
    s.onerror = () => { clearTimeout(timer); resolve(false); };
    document.head.appendChild(s);
  });
}

async function ensureWorkers() {
  if (workers.length && digitsWorker) return true;
  if (workerInit) return workerInit;
  workerInit = (async () => {
    if (!(await ensureTesseract())) return false;
    try {
      for (let i = 0; i < 3; i++) {
        const worker = await window.Tesseract.createWorker('eng');
        await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
        workers.push({ worker, busy: false });
      }
      digitsWorker = await window.Tesseract.createWorker('eng');
      await digitsWorker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789.,$US ', preserve_interword_spaces: '1' });
      return true;
    } catch (e) {
      diagnostics.lastError = `ocr-init:${e?.message || 'failed'}`;
      return false;
    }
  })();
  return workerInit;
}

async function takeWorker() {
  const start = now();
  while (now() - start < 2600) {
    const slot = workers.find((x) => !x.busy);
    if (slot) { slot.busy = true; return slot; }
    await new Promise((r) => setTimeout(r, 8));
  }
  return null;
}

async function readSeat(canvas) {
  const slot = await takeWorker();
  if (!slot) return { text: '', confidence: 0 };
  try {
    const out = await Promise.race([slot.worker.recognize(canvas), new Promise((r) => setTimeout(() => r(null), 2400))]);
    return out ? { text: String(out.data?.text || '').trim(), confidence: Number(out.data?.confidence) || 0 } : { text: '', confidence: 0 };
  } catch { return { text: '', confidence: 0 }; }
  finally { slot.busy = false; }
}

async function readDigits(canvas) {
  if (!digitsWorker) return null;
  try {
    const out = await Promise.race([digitsWorker.recognize(canvas), new Promise((r) => setTimeout(() => r(null), 1200))]);
    if (!out || (Number(out.data?.confidence) || 0) < 38) return null;
    return parsePokerStarsNumber(out.data?.text || '');
  } catch { return null; }
}

async function readTitle(source) {
  const rect = { x: 0, y: 0, w: 0.72, h: 0.055 };
  const crop = highContrast(cropNormalized(source, rect, 900));
  const r = await readSeat(crop);
  diagnostics.titleText = r.text.slice(0, 140);
  return inferPokerStarsTableSize(r.text);
}

function updateName(mem, candidate) {
  const value = String(candidate || '').trim();
  if (!value) return mem.actorName;
  if (mem.actorName && actorKey(mem.actorName) === actorKey(value)) { mem.pendingName = null; mem.nameHits = 0; return mem.actorName; }
  if (mem.pendingName && actorKey(mem.pendingName) === actorKey(value)) mem.nameHits++;
  else { mem.pendingName = value; mem.nameHits = 1; }
  if (mem.nameHits >= 3) { mem.actorName = mem.pendingName; mem.pendingName = null; mem.nameHits = 0; }
  return mem.actorName;
}

function chooseTableSize(source, feltRect, titleSize) {
  if (titleSize === 6 || titleSize === 9) {
    tableSizeVotes[titleSize] += 3;
  } else {
    const six = scoreLayout(source, seatRectsFromFelt(feltRect, 6));
    const nine = scoreLayout(source, seatRectsFromFelt(feltRect, 9));
    diagnostics.layoutScore6 = six.score;
    diagnostics.layoutScore9 = nine.score;
    if (nine.score > six.score + 0.10) tableSizeVotes[9]++;
    else if (six.score > nine.score + 0.10) tableSizeVotes[6]++;
  }
  if (!tableSize) {
    if (tableSizeVotes[9] >= 2 && tableSizeVotes[9] >= tableSizeVotes[6] + 1) tableSize = 9;
    else if (tableSizeVotes[6] >= 2 && tableSizeVotes[6] >= tableSizeVotes[9] + 1) tableSize = 6;
  }
  return tableSize;
}

function resetHand(handId, street) {
  lastHandId = handId; lastStreet = street; sourceEpoch++;
  tableSize = null; tableSizeVotes = { 6: 0, 9: 0 }; seatMemory = []; lastSignature = '';
  diagnostics.handId = handId; diagnostics.tableSize = null; diagnostics.expectedSeats = 0; diagnostics.trackedSeats = 0; diagnostics.activeSeats = 0;
  diagnostics.stableFrames = 0; diagnostics.trusted = false; diagnostics.trustReason = 'Detectando formato da mesa.'; diagnostics.seats = [];
}

function resetStreet(street) {
  lastStreet = street;
  for (const mem of seatMemory) mem.committedObs = { value: 0, pending: null, hits: 0 };
}

function appendEvents(events, handId) {
  for (const e of events || []) activeActionTimeline?.append({
    handId, street: e.street, actorName: e.actorName, seatLabel: e.seatLabel, action: e.action,
    amount: Number.isFinite(e.amount) ? e.amount : null, source: e.source || 'visual-table-r14b',
    confidence: Number.isFinite(e.confidence) ? e.confidence : 0.65, observedAt: now(),
  });
}

function ensureReadout() {
  let box = document.getElementById('tableVisionR14');
  if (box) return box;
  const coach = document.querySelector('.coach-card'); if (!coach) return null;
  box = document.createElement('div'); box.id = 'tableVisionR14'; box.className = 'table-vision-r14';
  box.innerHTML = '<span class="eyebrow">MESA VISUAL</span><strong id="tableVisionTitle">Validando mesa…</strong><div id="tableVisionTrust"></div><div id="tableVisionRows"></div>';
  const actions = document.getElementById('actions'); if (actions) actions.insertAdjacentElement('afterend', box); else coach.append(box);
  const style = document.createElement('style'); style.id = 'tableVisionR14StylesB';
  style.textContent = '.table-vision-r14{margin-top:12px;border:1px solid #2b383d;border-radius:10px;background:#0b1113;padding:11px}.table-vision-r14>strong{display:block;margin-top:5px;font-size:13px}.table-vision-trust{margin-top:5px;font-size:10px;color:#f2c44f}.table-vision-trust.ok{color:#63d49a}.table-vision-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:7px;padding-top:7px;border-top:1px solid #202b2f;font-size:11px}.table-vision-row span{color:#c7d1d4}.table-vision-row small{color:#7f8f95;text-align:right}.table-vision-row b{color:#63d49a;font-weight:800}';
  document.head.appendChild(style); return box;
}

function renderReadout(seats) {
  const box = ensureReadout(); if (!box) return;
  const title = document.getElementById('tableVisionTitle'); const trust = document.getElementById('tableVisionTrust'); const rows = document.getElementById('tableVisionRows');
  title.textContent = tableSize ? `${tableSize}-max · ${diagnostics.trackedSeats}/${diagnostics.expectedSeats} posições confirmadas` : 'Detectando 6-max / 9-max…';
  trust.className = `table-vision-trust${diagnostics.trusted ? ' ok' : ''}`;
  trust.textContent = diagnostics.trusted ? '✓ MESA VALIDADA PARA CÁLCULO' : `⚠ ${diagnostics.trustReason}`;
  rows.replaceChildren();
  for (const seat of seats) {
    const row = document.createElement('div'); row.className = 'table-vision-row';
    const left = document.createElement('span'); left.textContent = `${seat.hero ? 'VOCÊ · ' : ''}${seat.actorName || `Seat ${seat.seatIndex + 1}`}${seat.away ? ' · AUSENTE' : ''}`;
    const right = document.createElement('small');
    const stack = Number.isFinite(seat.stack) ? `stack ${Math.round(seat.stack * 100) / 100}` : 'stack ?';
    const committed = Number.isFinite(seat.committed) && seat.committed > 0 ? ` · pote ${Math.round(seat.committed * 100) / 100}` : '';
    const last = [...(activeActionTimeline?.events || [])].reverse().find((e) => actorKey(e.actorName) === actorKey(seat.actorName));
    right.innerHTML = `${stack}${committed}${last ? ` · <b>${String(last.action).toUpperCase()}</b>` : ''}`;
    row.append(left, right); rows.append(row);
  }
}

function updateTrust(resolved, active, heroStable, signature) {
  diagnostics.expectedSeats = tableSize || 0;
  diagnostics.trackedSeats = resolved;
  diagnostics.activeSeats = active;
  const coverage = tableSize ? resolved / tableSize : 0;
  if (signature && signature === lastSignature && coverage >= 0.72 && heroStable) diagnostics.stableFrames++;
  else diagnostics.stableFrames = Math.max(0, diagnostics.stableFrames - 1);
  lastSignature = signature;
  const enoughActive = active >= 2;
  diagnostics.trusted = Boolean(tableSize && coverage >= 0.72 && heroStable && enoughActive && diagnostics.stableFrames >= 3);
  diagnostics.trustReason = diagnostics.trusted
    ? 'Mesa confirmada por leituras consecutivas.'
    : !tableSize ? 'Ainda não confirmei se a mesa é 6-max ou 9-max.'
      : coverage < 0.72 ? `Só ${resolved}/${tableSize} posições foram reconhecidas com consistência.`
        : !heroStable ? 'Seu assento/stack ainda não estabilizou.'
          : !enoughActive ? 'Ainda não confirmei jogadores suficientes na mão.'
            : `Aguardando consenso visual (${diagnostics.stableFrames}/3).`;
}

async function readOnce() {
  const machine = activeHandMachine; const tracker = activeTableStateTracker; const source = visibleSource();
  if (!machine || !tracker || !source || machine.handId <= 0 || busy) return;
  const t = now(); if (t - lastReadAt < 680) return; lastReadAt = t;
  if (machine.handId !== lastHandId) resetHand(machine.handId, machine.state.street);
  else if (machine.state.street !== lastStreet) resetStreet(machine.state.street);
  if (!(await ensureWorkers())) return;
  const epoch = sourceEpoch; const canvas = snapshotSource(source); if (!canvas) return; busy = true; const t0 = now();
  try {
    const nextFelt = detectFelt({ canvas, w: canvas.width, h: canvas.height });
    if (!nextFelt) { diagnostics.lastError = 'felt-not-found'; diagnostics.trusted = false; return; }
    felt = stabilizeFelt(felt, nextFelt);
    const titleSize = tableSize ? null : await readTitle(canvas);
    const chosen = chooseTableSize(canvas, felt, titleSize);
    if (!chosen) { diagnostics.trustReason = 'Detectando formato da mesa.'; renderReadout([]); return; }
    diagnostics.tableSize = chosen;
    if (seatMemory.length !== chosen) seatMemory = Array.from({ length: chosen }, () => newSeatMemory());
    const rects = seatRectsFromFelt(felt, chosen);
    const seatCrops = rects.map((r) => highContrast(cropNormalized(canvas, r, 330)));
    const reads = await Promise.all(seatCrops.map(readSeat));
    if (epoch !== sourceEpoch || activeHandMachine?.handId !== machine.handId) return;
    const parsed = reads.map((r) => parseSeatText(r.text));

    const committedReads = Array(chosen).fill(null);
    if (machine.state.heroToAct) {
      for (let i = 0; i < chosen; i++) {
        const zone = commitmentRect(rects[i], felt);
        if (panelSignal(canvas, zone) < 0.045) continue;
        committedReads[i] = await readDigits(highContrast(cropNormalized(canvas, zone, 250)));
      }
    }

    const seats = []; let resolved = 0; let active = 0; let heroStable = false;
    for (let i = 0; i < chosen; i++) {
      const mem = seatMemory[i]; const p = parsed[i]; const read = reads[i]; mem.lastRaw = p.raw;
      if (p.empty) { mem.empty = true; mem.away = false; mem.folded = true; resolved++; continue; }
      mem.empty = false; mem.away = Boolean(p.away);
      const name = updateName(mem, p.actorName) || mem.actorName;
      const stackUpdate = stableNumericObservation(mem.stackObs, p.stack, { tolerance: 0.018, hits: 2 }); mem.stackObs = stackUpdate.memory;
      const committedUpdate = stableNumericObservation(mem.committedObs, committedReads[i], { tolerance: 0.035, hits: 2 }); mem.committedObs = committedUpdate.memory;
      if (p.visibleAction === 'fold') mem.folded = true;
      else if (p.visibleAction && p.visibleAction !== 'fold') mem.folded = false;
      if (mem.away) mem.folded = true;
      const stack = Number.isFinite(mem.stackObs.value) ? mem.stackObs.value : null;
      const committed = Number.isFinite(mem.committedObs.value) ? mem.committedObs.value : 0;
      const seatResolved = mem.away || Boolean(name) || Number.isFinite(stack) || Boolean(p.visibleAction);
      if (seatResolved) resolved++;
      const occupied = seatResolved && !mem.away;
      if (occupied && !mem.folded) active++;
      const confidence = clamp((read.confidence || 0) / 100 * 0.45 + (name ? 0.18 : 0) + (Number.isFinite(stack) ? 0.27 : 0) + (p.visibleAction ? 0.10 : 0), 0.42, 0.97);
      if (!seatResolved) continue;
      const actorName = name || `Seat ${i + 1}`;
      const seat = { seatIndex: i, actorName, stack, committed, dealer: false, folded: mem.folded, hero: i === 0, visibleAction: p.visibleAction, visibleActionAmount: p.visibleActionAmount, confidence, away: mem.away };
      seats.push(seat);
      if (i === 0 && Number.isFinite(stack) && confidence >= 0.62) heroStable = true;
    }

    const signature = seats.map((s) => `${s.seatIndex}:${s.actorName}:${Number.isFinite(s.stack) ? Math.round(s.stack * 100) / 100 : '-'}:${s.away ? 'A' : s.folded ? 'F' : 'P'}`).join('|');
    updateTrust(resolved, active, heroStable, signature);
    const snapshot = { handId: machine.handId, street: machine.state.street, confidence: diagnostics.trusted ? Math.max(0.78, seats.reduce((a, s) => a + s.confidence, 0) / Math.max(1, seats.length)) : 0, seats };
    const result = tracker.ingest(snapshot);
    if (result.accepted && diagnostics.trusted) appendEvents(result.events, machine.handId);
    diagnostics.reads++; diagnostics.lastMs = now() - t0; diagnostics.seats = seats.map((s) => ({ ...s })); diagnostics.lastError = null;
    renderReadout(result.state?.seats || seats);
  } catch (e) {
    diagnostics.lastError = e?.message || 'visual-table-error'; diagnostics.trusted = false; diagnostics.trustReason = 'Erro durante validação visual da mesa.';
  } finally { busy = false; }
}

setInterval(() => void readOnce(), 360);
setTimeout(() => void readOnce(), 700);
