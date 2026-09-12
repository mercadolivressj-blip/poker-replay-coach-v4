import { activeHandMachine } from '../core/state-machine.js';
import { activeActionTimeline } from '../core/action-timeline.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';

const SUIT_SYMBOL = { clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' };
const diagnostics = {
  source: 'gpt-5.6-luna-full-frame',
  enabled: true,
  handId: 0,
  requests: 0,
  responses: 0,
  failures: 0,
  inFlight: 0,
  trusted: false,
  trustReason: 'Aguardando a primeira leitura da IA.',
  stableFrames: 0,
  lastSeenAt: 0,
  lastLatencyMs: null,
  confidence: 0,
  heroConfidence: 0,
  boardConfidence: 0,
  potConfidence: 0,
  seatsConfidence: 0,
  tableSize: null,
  hero: [],
  board: [],
  pot: null,
  heroToAct: null,
  seats: [],
  lastError: null,
  manual: { hero: false, board: false, pot: false },
};
if (typeof window !== 'undefined') window.__prcAIStateR14 = diagnostics;

let generation = 0;
let captureSeq = 0;
let lastAppliedSeq = 0;
let lastCaptureAt = 0;
let heroCandidate = null;
let boardCandidate = null;
let potCandidate = null;
let structuralSignature = '';
let accessToken = '';
try { accessToken = sessionStorage.getItem('prc.vision-token') || ''; } catch {}

function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function actorKey(v) { return String(v || '').trim().toLowerCase(); }
function cardId(c) { return c?.rank && c?.suit ? `${String(c.rank).toUpperCase()}${String(c.suit)}` : '?'; }
function cardsKey(cards) { return (cards || []).map(cardId).join(','); }
function exactCards(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && cardsKey(a) === cardsKey(b); }
function fmt(n) { return Number.isFinite(n) ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(n) : '—'; }
function cardLabel(cards) { return (cards || []).map((c) => `${c.rank || '?'}${SUIT_SYMBOL[c.suit] || '?'}`).join(' '); }
function closeMoney(a, b) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.018); }

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
  c.width = Math.max(640, Math.round(sw * scale));
  c.height = Math.max(360, Math.round(sh * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function resetForHand(handId) {
  generation++;
  diagnostics.handId = handId;
  diagnostics.trusted = false;
  diagnostics.trustReason = 'IA confirmando a nova mão.';
  diagnostics.stableFrames = 0;
  diagnostics.lastSeenAt = 0;
  diagnostics.hero = [];
  diagnostics.board = [];
  diagnostics.pot = null;
  diagnostics.seats = [];
  diagnostics.lastError = null;
  diagnostics.manual = { hero: false, board: false, pot: false };
  captureSeq = 0;
  lastAppliedSeq = 0;
  heroCandidate = null;
  boardCandidate = null;
  potCandidate = null;
  structuralSignature = '';
}

function bumpCardCandidate(current, cards, confidence, minConfidence, validLengths) {
  if (!Array.isArray(cards) || !validLengths.includes(cards.length) || confidence < minConfidence) return null;
  if (cards.length === 0) return { key: 'empty', cards: [], hits: (current?.key === 'empty' ? current.hits + 1 : 1), confidence };
  const key = cardsKey(cards);
  if (!key || key.includes('?')) return null;
  return current?.key === key ? { key, cards, hits: current.hits + 1, confidence } : { key, cards, hits: 1, confidence };
}

function bumpPotCandidate(current, value, confidence) {
  if (!Number.isFinite(value) || value <= 0 || confidence < 0.80) return null;
  return current && closeMoney(current.value, value)
    ? { value, hits: current.hits + 1, confidence }
    : { value, hits: 1, confidence };
}

function structuralKey(out) {
  const heroSeat = (out.seats || []).find((s) => s.hero);
  const names = (out.seats || []).map((s) => `${s.seatIndex}:${actorKey(s.actorName) || '?'}`).sort().join('|');
  return `${out.tableSize || '-'}#${heroSeat?.seatIndex ?? '-'}#${names}`;
}

function authoritativeToken() {
  const arbiter = typeof window !== 'undefined' ? window.__prcDealArbiterR14 : null;
  return arbiter?.beginManualRecalibration?.(now()) || null;
}

function commitAIHero(cards) {
  const machine = activeHandMachine;
  if (!machine || diagnostics.manual.hero || !Array.isArray(cards) || cards.length !== 2) return false;
  const current = machine.state.hero || [];
  if (exactCards(current, cards)) return true;
  if (!current.length) return machine.setHero(cards, machine.handId, { source: 'ai-full-frame', now: now() });
  const token = authoritativeToken();
  return machine.setHero(cards, machine.handId, { source: 'ai-full-frame', rebindToken: token, forceRebind: true, now: now() });
}

function commitAIBoard(cards) {
  const machine = activeHandMachine;
  if (!machine || diagnostics.manual.board || !Array.isArray(cards) || ![0,3,4,5].includes(cards.length)) return false;
  const current = machine.state.board || [];
  if (exactCards(current, cards)) return true;
  if (!current.length && cards.length) return machine.setBoard(cards, machine.handId, { source: 'ai-full-frame', now: now() });
  if (!cards.length) return current.length === 0;
  const token = authoritativeToken();
  return machine.setBoard(cards, machine.handId, { source: 'ai-full-frame', rebindToken: token, forceRebind: true, now: now() });
}

function commitAIPot(value) {
  const machine = activeHandMachine;
  if (!machine || diagnostics.manual.pot || !Number.isFinite(value) || value <= 0) return false;
  return machine.setPot(value, machine.handId, { source: 'ai-full-frame', now: now() });
}

function appendTimeline(events, handId) {
  for (const e of events || []) {
    activeActionTimeline?.append({
      handId,
      street: e.street,
      actorName: e.actorName,
      seatLabel: e.seatLabel,
      action: e.action,
      amount: Number.isFinite(e.amount) ? e.amount : null,
      source: e.source || 'ai-full-frame-r14',
      confidence: Number.isFinite(e.confidence) ? e.confidence : 0.8,
      observedAt: now(),
    });
  }
}

function updateTrust(out) {
  const machine = activeHandMachine;
  const seats = out.seats || [];
  const heroSeats = seats.filter((s) => s.hero);
  const visiblePlayers = seats.filter((s) => s.folded !== true && (s.actorName || Number.isFinite(s.stack)));
  const boardLengthOk = [0,3,4,5].includes((out.board || []).length);
  const expectedStreet = (out.board || []).length === 5 ? 'river' : (out.board || []).length === 4 ? 'turn' : (out.board || []).length === 3 ? 'flop' : 'preflop';
  const streetOk = boardLengthOk && out.street === expectedStreet;

  const stateHero = machine?.state?.hero || [];
  const stateBoard = machine?.state?.board || [];
  const statePot = Number(machine?.state?.pot);
  const heroOk = diagnostics.manual.hero || (diagnostics.hero.length === 2 && exactCards(stateHero, diagnostics.hero));
  const boardOk = diagnostics.manual.board || (streetOk && exactCards(stateBoard, diagnostics.board));
  const potOk = diagnostics.manual.pot || (Number.isFinite(diagnostics.pot) && closeMoney(statePot, diagnostics.pot));
  const seatsOk = out.seatsConfidence >= 0.76 && seats.length >= 2 && heroSeats.length === 1 && visiblePlayers.length >= 2;
  const overallOk = out.confidence >= 0.74;

  const sig = structuralKey(out);
  if (sig && sig === structuralSignature && seatsOk && overallOk) diagnostics.stableFrames++;
  else diagnostics.stableFrames = seatsOk && overallOk ? 1 : 0;
  structuralSignature = sig;

  const fresh = now() - diagnostics.lastSeenAt <= 4500;
  diagnostics.trusted = Boolean(heroOk && boardOk && potOk && seatsOk && overallOk && diagnostics.stableFrames >= 2 && fresh);

  if (diagnostics.trusted) diagnostics.trustReason = '✓ IA confirmou cartas, board, pote e jogadores no frame inteiro.';
  else if (!overallOk) diagnostics.trustReason = `IA com baixa confiança geral (${Math.round((out.confidence || 0) * 100)}%).`;
  else if (!heroOk) diagnostics.trustReason = 'IA ainda não sincronizou suas cartas com o estado do Coach.';
  else if (!boardOk) diagnostics.trustReason = 'IA ainda não sincronizou o board/street.';
  else if (!potOk) diagnostics.trustReason = 'IA ainda não sincronizou o pote central.';
  else if (!seatsOk) diagnostics.trustReason = 'IA ainda não confirmou jogadores/assentos suficientes.';
  else diagnostics.trustReason = `Aguardando segunda confirmação da IA (${diagnostics.stableFrames}/2).`;

  if (diagnostics.manual.hero) diagnostics.hero = (machine.state.hero || []).map((c) => ({ ...c }));
  if (diagnostics.manual.board) diagnostics.board = (machine.state.board || []).map((c) => ({ ...c }));
  if (diagnostics.manual.pot) diagnostics.pot = Number(machine.state.pot) || diagnostics.pot;
}

function applyState(out) {
  const machine = activeHandMachine;
  const tracker = activeTableStateTracker;
  if (!machine || !tracker || out.handId !== machine.handId) return;

  diagnostics.responses++;
  diagnostics.lastSeenAt = now();
  diagnostics.lastLatencyMs = Number(out.ms) || null;
  diagnostics.confidence = Number(out.confidence) || 0;
  diagnostics.heroConfidence = Number(out.heroConfidence) || 0;
  diagnostics.boardConfidence = Number(out.boardConfidence) || 0;
  diagnostics.potConfidence = Number(out.potConfidence) || 0;
  diagnostics.seatsConfidence = Number(out.seatsConfidence) || 0;
  diagnostics.tableSize = Number.isInteger(out.tableSize) ? out.tableSize : null;
  diagnostics.heroToAct = typeof out.heroToAct === 'boolean' ? out.heroToAct : null;
  diagnostics.seats = Array.isArray(out.seats) ? out.seats.map((s) => ({ ...s })) : [];
  diagnostics.lastError = null;

  if (!diagnostics.manual.hero) {
    heroCandidate = bumpCardCandidate(heroCandidate, out.hero, diagnostics.heroConfidence, 0.82, [2]);
    if (heroCandidate?.hits >= 2 && commitAIHero(heroCandidate.cards)) diagnostics.hero = heroCandidate.cards.map((c) => ({ ...c }));
  }

  if (!diagnostics.manual.board) {
    boardCandidate = bumpCardCandidate(boardCandidate, out.board, diagnostics.boardConfidence, out.board?.length ? 0.78 : 0.68, [0,3,4,5]);
    if (boardCandidate?.hits >= 2) {
      if (commitAIBoard(boardCandidate.cards) || boardCandidate.cards.length === 0) diagnostics.board = boardCandidate.cards.map((c) => ({ ...c }));
    }
  }

  if (!diagnostics.manual.pot) {
    potCandidate = bumpPotCandidate(potCandidate, out.pot, diagnostics.potConfidence);
    if (potCandidate?.hits >= 2 && commitAIPot(potCandidate.value)) diagnostics.pot = potCandidate.value;
  }

  const snapshot = {
    handId: machine.handId,
    street: out.street || machine.state.street,
    confidence: Math.min(Number(out.confidence) || 0, Number(out.seatsConfidence) || 0),
    seats: diagnostics.seats,
  };
  const tracked = tracker.ingest(snapshot);
  if (tracked.accepted && diagnostics.seatsConfidence >= 0.76 && diagnostics.confidence >= 0.74) appendTimeline(tracked.events, machine.handId);

  updateTrust(out);
  renderReadout();
}

function ensureReadout() {
  let box = document.getElementById('tableVisionR14');
  if (box) return box;
  const coach = document.querySelector('.coach-card');
  if (!coach) return null;
  box = document.createElement('div');
  box.id = 'tableVisionR14';
  box.className = 'table-vision-r14';
  box.innerHTML = '<span class="eyebrow">MESA IA · FRAME INTEIRO</span><strong id="tableVisionTitle">Conectando visão…</strong><div id="tableVisionTrust"></div><div id="tableVisionRows"></div>';
  const actions = document.getElementById('actions');
  if (actions) actions.insertAdjacentElement('afterend', box); else coach.append(box);
  if (!document.getElementById('tableVisionAIStyles')) {
    const style = document.createElement('style');
    style.id = 'tableVisionAIStyles';
    style.textContent = '.table-vision-r14{margin-top:12px;border:1px solid #2b383d;border-radius:10px;background:#0b1113;padding:11px}.table-vision-r14>strong{display:block;margin-top:5px;font-size:13px}.table-vision-trust{margin-top:5px;font-size:10px;color:#f2c44f}.table-vision-trust.ok{color:#63d49a}.table-vision-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:6px;padding-top:6px;border-top:1px solid #202b2f;font-size:10px}.table-vision-row span{color:#c7d1d4}.table-vision-row small{color:#8b999e;text-align:right}.table-vision-row b{color:#63d49a}';
    document.head.appendChild(style);
  }
  return box;
}

function renderReadout() {
  const box = ensureReadout();
  if (!box) return;
  const title = document.getElementById('tableVisionTitle');
  const trust = document.getElementById('tableVisionTrust');
  const rows = document.getElementById('tableVisionRows');
  if (!title || !trust || !rows) return;

  const latency = Number.isFinite(diagnostics.lastLatencyMs) ? ` · ${diagnostics.lastLatencyMs}ms` : '';
  title.textContent = diagnostics.responses
    ? `IA ${Math.round(diagnostics.confidence * 100)}%${latency} · ${diagnostics.seats.length} assentos${diagnostics.tableSize ? ` · ${diagnostics.tableSize}-max` : ''}`
    : diagnostics.lastError ? `IA indisponível · ${diagnostics.lastError}` : 'IA lendo o frame inteiro…';
  trust.className = `table-vision-trust${diagnostics.trusted ? ' ok' : ''}`;
  trust.textContent = diagnostics.trustReason;
  rows.replaceChildren();

  const summary = document.createElement('div');
  summary.className = 'table-vision-row';
  const left = document.createElement('span');
  left.textContent = `Hero ${diagnostics.hero.length ? cardLabel(diagnostics.hero) : '—'} · Board ${diagnostics.board.length ? cardLabel(diagnostics.board) : '—'}`;
  const right = document.createElement('small');
  right.innerHTML = `Pote <b>${fmt(diagnostics.pot)}</b>`;
  summary.append(left, right);
  rows.append(summary);

  for (const seat of diagnostics.seats) {
    const row = document.createElement('div');
    row.className = 'table-vision-row';
    const l = document.createElement('span');
    l.textContent = `${seat.hero ? 'VOCÊ · ' : ''}${seat.actorName || `Seat ${seat.seatIndex}`}`;
    const r = document.createElement('small');
    const action = seat.visibleAction ? ` · <b>${String(seat.visibleAction).toUpperCase()}</b>${Number.isFinite(seat.visibleActionAmount) ? ` ${fmt(seat.visibleActionAmount)}` : ''}` : '';
    r.innerHTML = `stack ${fmt(seat.stack)}${Number.isFinite(seat.committed) && seat.committed > 0 ? ` · mesa ${fmt(seat.committed)}` : ''}${action}`;
    row.append(l, r);
    rows.append(row);
  }
}

async function requestFrame(seq, canvas, handId, localGeneration) {
  diagnostics.inFlight++;
  diagnostics.requests++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const image = canvas.toDataURL('image/jpeg', 0.78);
    const r = await fetch('/api/full-state', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(accessToken ? { 'x-coach-token': accessToken } : {}) },
      body: JSON.stringify({ mode: 'replay', image, handId, fingerprint: `r14:${handId}:${seq}` }),
      signal: controller.signal,
    });
    if (localGeneration !== generation) return;

    if (!r.ok) {
      let reason = `HTTP ${r.status}`;
      try { const j = await r.json(); if (j?.error) reason += ` · ${j.error}`; } catch {}
      diagnostics.failures++;
      if (seq > lastAppliedSeq) diagnostics.lastError = reason;
      return;
    }

    const out = await r.json();
    if (localGeneration !== generation || seq <= lastAppliedSeq) return;
    lastAppliedSeq = seq;
    applyState(out);
  } catch (e) {
    if (localGeneration !== generation) return;
    diagnostics.failures++;
    if (seq > lastAppliedSeq) diagnostics.lastError = e?.name === 'AbortError' ? 'timeout da IA' : 'falha de rede da IA';
  } finally {
    clearTimeout(timer);
    diagnostics.inFlight = Math.max(0, diagnostics.inFlight - 1);
    renderReadout();
  }
}

function captureTick() {
  const machine = activeHandMachine;
  const source = visibleSource();
  if (!machine || !source || machine.handId <= 0) return;
  if (diagnostics.handId !== machine.handId) resetForHand(machine.handId);

  const t = now();
  const interval = diagnostics.trusted ? 900 : (machine.state.heroToAct ? 450 : 700);
  if (t - lastCaptureAt < interval || diagnostics.inFlight >= 2) return;
  const canvas = snapshotSource(source);
  if (!canvas) return;
  lastCaptureAt = t;
  const seq = ++captureSeq;
  void requestFrame(seq, canvas, machine.handId, generation);
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', (e) => resetForHand(Number(e.detail?.generation) || activeHandMachine?.handId || 0));
  window.addEventListener('prc:manual-state-applied', (e) => {
    if (!e.detail || Number(e.detail.generation) !== activeHandMachine?.handId) return;
    diagnostics.manual.hero = diagnostics.manual.hero || Boolean(e.detail.hero);
    diagnostics.manual.board = diagnostics.manual.board || Boolean(e.detail.board);
    diagnostics.manual.pot = diagnostics.manual.pot || Boolean(e.detail.pot);
    if (e.detail.hero) diagnostics.hero = (activeHandMachine.state.hero || []).map((c) => ({ ...c }));
    if (e.detail.board) diagnostics.board = (activeHandMachine.state.board || []).map((c) => ({ ...c }));
    if (e.detail.pot) diagnostics.pot = Number(activeHandMachine.state.pot) || diagnostics.pot;
    renderReadout();
  });
  window.__prcAIRefreshR14 = () => {
    lastCaptureAt = 0;
    diagnostics.stableFrames = 0;
    diagnostics.trusted = false;
    diagnostics.lastError = null;
    diagnostics.trustReason = 'Refresh solicitado · IA relendo o frame inteiro.';
    captureTick();
  };
}

setInterval(captureTick, 160);
setTimeout(() => { ensureReadout(); captureTick(); }, 300);
