import { activeHandMachine } from '../core/state-machine.js';

const diagnostics = {
  enabled: true,
  source: 'gpt-5.6-luna-decision-frame',
  handId: 0,
  requests: 0,
  responses: 0,
  failures: 0,
  inFlight: 0,
  trusted: false,
  lastSeenAt: 0,
  lastLatencyMs: null,
  confidence: 0,
  heroConfidence: 0,
  boardConfidence: 0,
  potConfidence: 0,
  actionsConfidence: 0,
  aggressorConfidence: 0,
  hero: [],
  board: [],
  pot: null,
  heroToAct: null,
  actions: [],
  aggressorName: null,
  aggressorCommitted: null,
  heroCommitted: null,
  lastError: null,
  trustReason: 'Aguardando decisão do Hero.',
};
if (typeof window !== 'undefined') window.__prcAIDecisionR14 = diagnostics;

let generation = 0;
let seq = 0;
let lastAppliedSeq = 0;
let lastCaptureAt = 0;
let accessToken = '';
try { accessToken = sessionStorage.getItem('prc.vision-token') || ''; } catch {}

function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function cardId(c) { return c?.rank && c?.suit ? `${String(c.rank).toUpperCase()}${String(c.suit)}` : '?'; }
function cardsKey(cards) { return (cards || []).map(cardId).join(','); }
function exactCards(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && cardsKey(a) === cardsKey(b); }
function closeMoney(a, b) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.02); }

function visibleSource() {
  const video = document.getElementById('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return video;
  const image = document.getElementById('image');
  if (image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0) return image;
  return null;
}

function snapshot(source, maxWidth = 1080) {
  const sw = source?.videoWidth || source?.naturalWidth || source?.width || 0;
  const sh = source?.videoHeight || source?.naturalHeight || source?.height || 0;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxWidth / sw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(640, Math.round(sw * scale));
  canvas.height = Math.max(360, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function authoritativeToken() {
  return window.__prcDealArbiterR14?.beginManualRecalibration?.(now()) || null;
}

function fillDerivedCall(actions, aggressorCommitted, heroCommitted) {
  const out = (actions || []).map((a) => ({ type: a.type, amount: Number.isFinite(a.amount) ? a.amount : null }));
  const call = out.find((a) => a.type === 'call');
  if (call && !Number.isFinite(call.amount) && Number.isFinite(aggressorCommitted) && Number.isFinite(heroCommitted)) {
    const amount = Math.max(0, aggressorCommitted - heroCommitted);
    if (amount > 0) call.amount = Math.round(amount * 1000) / 1000;
  }
  return out;
}

function commitCritical(out) {
  const machine = activeHandMachine;
  if (!machine || out.handId !== machine.handId) return;
  const t = now();
  const token = authoritativeToken();

  if (Array.isArray(out.hero) && out.hero.length === 2 && out.heroConfidence >= 0.88 && !exactCards(machine.state.hero || [], out.hero)) {
    machine.setHero(out.hero, machine.handId, { source: 'ai-decision', rebindToken: token, forceRebind: true, now: t });
  }
  if (Array.isArray(out.board) && [0,3,4,5].includes(out.board.length) && out.boardConfidence >= 0.84 && !exactCards(machine.state.board || [], out.board)) {
    if (out.board.length || !(machine.state.board || []).length) machine.setBoard(out.board, machine.handId, { source: 'ai-decision', rebindToken: token, forceRebind: true, now: t });
  }
  if (Number.isFinite(out.pot) && out.pot > 0 && out.potConfidence >= 0.88 && !closeMoney(Number(machine.state.pot), out.pot)) {
    machine.setPot(out.pot, machine.handId, { source: 'ai-decision', now: t });
  }
}

function apply(out) {
  const machine = activeHandMachine;
  if (!machine || out.handId !== machine.handId) return;
  diagnostics.responses++;
  diagnostics.handId = out.handId;
  diagnostics.lastSeenAt = now();
  diagnostics.lastLatencyMs = Number(out.ms) || null;
  diagnostics.confidence = Number(out.confidence) || 0;
  diagnostics.heroConfidence = Number(out.heroConfidence) || 0;
  diagnostics.boardConfidence = Number(out.boardConfidence) || 0;
  diagnostics.potConfidence = Number(out.potConfidence) || 0;
  diagnostics.actionsConfidence = Number(out.actionsConfidence) || 0;
  diagnostics.aggressorConfidence = Number(out.aggressorConfidence) || 0;
  diagnostics.hero = Array.isArray(out.hero) ? out.hero.map((c) => ({ ...c })) : [];
  diagnostics.board = Array.isArray(out.board) ? out.board.map((c) => ({ ...c })) : [];
  diagnostics.pot = Number.isFinite(out.pot) ? out.pot : null;
  diagnostics.heroToAct = typeof out.heroToAct === 'boolean' ? out.heroToAct : null;
  diagnostics.aggressorName = out.aggressorName || null;
  diagnostics.aggressorCommitted = Number.isFinite(out.aggressorCommitted) ? out.aggressorCommitted : null;
  diagnostics.heroCommitted = Number.isFinite(out.heroCommitted) ? out.heroCommitted : null;
  diagnostics.actions = fillDerivedCall(out.heroActions, diagnostics.aggressorCommitted, diagnostics.heroCommitted);
  diagnostics.lastError = null;

  commitCritical(out);

  const stateHero = machine.state.hero || [];
  const stateBoard = machine.state.board || [];
  const statePot = Number(machine.state.pot);
  const heroOk = diagnostics.hero.length === 2 && exactCards(stateHero, diagnostics.hero);
  const boardOk = [0,3,4,5].includes(diagnostics.board.length) && exactCards(stateBoard, diagnostics.board);
  const potOk = Number.isFinite(diagnostics.pot) && closeMoney(statePot, diagnostics.pot);
  const call = diagnostics.actions.find((a) => a.type === 'call');
  const actionAmountsOk = !call || Number.isFinite(call.amount);
  const actionsOk = diagnostics.heroToAct === true && diagnostics.actions.length >= 2 && diagnostics.actionsConfidence >= 0.82 && actionAmountsOk;
  const confidenceOk = diagnostics.confidence >= 0.86 && diagnostics.heroConfidence >= 0.86 && diagnostics.boardConfidence >= 0.80 && diagnostics.potConfidence >= 0.86;

  diagnostics.trusted = Boolean(heroOk && boardOk && potOk && actionsOk && confidenceOk);
  if (diagnostics.trusted) diagnostics.trustReason = '✓ Decisão atual confirmada pela IA rápida.';
  else if (!heroOk) diagnostics.trustReason = 'IA rápida ainda confirmando suas cartas.';
  else if (!boardOk) diagnostics.trustReason = 'IA rápida ainda confirmando board/street.';
  else if (!potOk) diagnostics.trustReason = 'IA rápida ainda confirmando o pote atual.';
  else if (!actionsOk) diagnostics.trustReason = 'IA rápida ainda confirmando CALL/CHECK/RAISE e valores.';
  else diagnostics.trustReason = 'IA rápida com confiança abaixo do limite.';
}

async function requestFrame(localSeq, canvas, handId, localGeneration) {
  diagnostics.inFlight++;
  diagnostics.requests++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7600);
  try {
    const image = canvas.toDataURL('image/jpeg', 0.72);
    const r = await fetch('/api/decision-state', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(accessToken ? { 'x-coach-token': accessToken } : {}) },
      body: JSON.stringify({ mode: 'replay', image, handId, fingerprint: `decision:${handId}:${localSeq}` }),
      signal: controller.signal,
    });
    if (localGeneration !== generation) return;
    if (!r.ok) {
      let reason = `HTTP ${r.status}`;
      try { const j = await r.json(); if (j?.error) reason += ` · ${j.error}`; } catch {}
      diagnostics.failures++;
      if (localSeq > lastAppliedSeq) diagnostics.lastError = reason;
      return;
    }
    const out = await r.json();
    if (localGeneration !== generation || localSeq <= lastAppliedSeq) return;
    lastAppliedSeq = localSeq;
    apply(out);
  } catch (e) {
    if (localGeneration !== generation) return;
    diagnostics.failures++;
    if (localSeq > lastAppliedSeq) diagnostics.lastError = e?.name === 'AbortError' ? 'timeout da IA rápida' : 'falha de rede da IA rápida';
  } finally {
    clearTimeout(timer);
    diagnostics.inFlight = Math.max(0, diagnostics.inFlight - 1);
  }
}

function reset(handId) {
  generation++;
  diagnostics.handId = handId;
  diagnostics.trusted = false;
  diagnostics.lastSeenAt = 0;
  diagnostics.actions = [];
  diagnostics.aggressorName = null;
  diagnostics.lastError = null;
  diagnostics.trustReason = 'Aguardando decisão do Hero.';
  seq = 0;
  lastAppliedSeq = 0;
  lastCaptureAt = 0;
}

function tick() {
  const machine = activeHandMachine;
  const source = visibleSource();
  if (!machine || !source || machine.handId <= 0) return;
  if (diagnostics.handId !== machine.handId) reset(machine.handId);

  const full = window.__prcAIStateR14;
  const heroTurn = Boolean(machine.state.heroToAct || full?.heroToAct === true);
  if (!heroTurn) {
    diagnostics.trusted = false;
    diagnostics.trustReason = 'Aguardando decisão do Hero.';
    return;
  }

  const t = now();
  const interval = diagnostics.trusted ? 1200 : 320;
  if (t - lastCaptureAt < interval || diagnostics.inFlight >= 2) return;
  const canvas = snapshot(source);
  if (!canvas) return;
  lastCaptureAt = t;
  const localSeq = ++seq;
  void requestFrame(localSeq, canvas, machine.handId, generation);
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', (e) => reset(Number(e.detail?.generation) || activeHandMachine?.handId || 0));
  window.__prcAIDecisionRefreshR14 = () => { lastCaptureAt = 0; diagnostics.trusted = false; tick(); };
}

setInterval(tick, 120);
setTimeout(tick, 250);
