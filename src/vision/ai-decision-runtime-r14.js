import { activeHandMachine } from '../core/state-machine.js';

const diagnostics = {
  enabled: true,
  source: 'gpt-5.6-luna-decision-frame',
  handId: 0,
  requests: 0,
  responses: 0,
  failures: 0,
  consecutiveFailures: 0,
  inFlight: 0,
  trusted: false,
  lastSeenAt: 0,
  lastSuccessAt: 0,
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
  rawStableFrames: 0,
  publicPrepared: false,
  publicPreparedAt: 0,
  heroLateBindings: 0,
  lastError: null,
  trustReason: 'Aguardando decisão do Hero.',
};
if (typeof window !== 'undefined') window.__prcAIDecisionR14 = diagnostics;

let generation = 0;
let seq = 0;
let lastAppliedSeq = 0;
let lastCaptureAt = 0;
let nextRetryAt = 0;
let burstRemaining = 0;
let lastHeroTurn = false;
let turnSignalStartedAt = 0;
let candidateKey = '';
let candidateHits = 0;
const settledResponses = new Map();
let accessToken = '';
try { accessToken = sessionStorage.getItem('prc.vision-token') || ''; } catch {}

function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function cardId(c) { return c?.rank && c?.suit ? `${String(c.rank).toUpperCase()}${String(c.suit)}` : '?'; }
function cardsKey(cards) { return (cards || []).map(cardId).join(','); }
function exactCards(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && cardsKey(a) === cardsKey(b); }
function closeMoney(a, b) { return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.02); }
function fmt(n) { return Number.isFinite(n) ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(n) : '—'; }
function actionKey(actions) { return (actions || []).map((a) => `${a.type}:${Number.isFinite(a.amount) ? a.amount : '-'}`).sort().join('|'); }
function moneyKey(value) { return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '-'; }

function manualHeroCards(machine = activeHandMachine) {
  if (typeof window === 'undefined' || !machine || machine.handId <= 0) return [];
  const authority = window.__prcManualHeroAuthorityR14;
  const hero = Array.isArray(machine.state?.hero) ? machine.state.hero : [];
  const ready = Boolean(
    authority?.manualOnly
    && authority?.heroLocked
    && Number(authority.handId) === Number(machine.handId)
    && hero.length === 2
    && hero.every((card) => card?.rank && card?.suit)
  );
  return ready ? hero.map((card) => ({ ...card })) : [];
}

function visibleSource() {
  const video = document.getElementById('video');
  if (video && video.style.display !== 'none' && video.readyState >= 2 && video.videoWidth > 0) return video;
  const image = document.getElementById('image');
  if (image && image.style.display !== 'none' && image.complete && image.naturalWidth > 0) return image;
  return null;
}

function snapshot(source, maxWidth = 1024) {
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

// IMPORTANT: Hero is manual-only and therefore MUST NOT participate in public
// 2/2 consensus. This lets the Coach pre-read the complete public decision while
// the user is still entering Hero cards, then bind Hero instantly afterwards.
function decisionSnapshotKey() {
  return [
    diagnostics.handId,
    cardsKey(diagnostics.board),
    moneyKey(diagnostics.pot),
    actionKey(diagnostics.actions),
    String(diagnostics.aggressorName || '').trim().toLowerCase(),
    moneyKey(diagnostics.aggressorCommitted),
    moneyKey(diagnostics.heroCommitted),
  ].join('#');
}

function observeCandidate() {
  const key = decisionSnapshotKey();
  if (key && key === candidateKey) candidateHits++;
  else {
    candidateKey = key;
    candidateHits = key ? 1 : 0;
  }
  diagnostics.rawStableFrames = candidateHits;
  return candidateHits;
}

function commitCritical(out) {
  const machine = activeHandMachine;
  if (!machine || out.handId !== machine.handId || candidateHits < 2) return;
  const t = now();
  const token = authoritativeToken();
  // Hero is manual-only in R14. Fast vision may update only public state.
  if (Array.isArray(out.board) && [0, 3, 4, 5].includes(out.board.length) && out.boardConfidence >= 0.84 && !exactCards(machine.state.board || [], diagnostics.board)) {
    if (out.board.length || !(machine.state.board || []).length) machine.setBoard(out.board, machine.handId, { source: 'ai-decision', rebindToken: token, forceRebind: true, now: t });
  }
  if (Number.isFinite(out.pot) && out.pot > 0 && out.potConfidence >= 0.88 && !closeMoney(Number(machine.state.pot), diagnostics.pot)) {
    machine.setPot(out.pot, machine.handId, { source: 'ai-decision', now: t });
  }
}

function uiHeroTurn() {
  const chip = String(document.getElementById('turnChip')?.textContent || '').toUpperCase();
  return chip.includes('SUA VEZ');
}

function fullFrameHeroTurn(machine) {
  if (typeof window === 'undefined') return false;
  const full = window.__prcAIStateR14;
  if (!full || Number(full.handId) !== Number(machine?.handId) || full.heroToAct !== true) return false;
  const age = Number.isFinite(Number(full.lastSeenAt)) && Number(full.lastSeenAt) > 0 ? now() - Number(full.lastSeenAt) : Infinity;
  const latency = Math.max(0, Number(full.lastLatencyMs) || 0);
  const freshnessWindow = Math.max(3500, Math.min(6500, latency + 2200));
  return age <= freshnessWindow;
}

function fastFrameStillHeroTurn(machine) {
  if (Number(diagnostics.handId) !== Number(machine?.handId)) return false;
  const age = Number.isFinite(Number(diagnostics.lastSeenAt)) && Number(diagnostics.lastSeenAt) > 0 ? now() - Number(diagnostics.lastSeenAt) : Infinity;
  const latency = Math.max(0, Number(diagnostics.lastLatencyMs) || 0);
  const freshnessWindow = Math.max(3000, Math.min(5200, latency + 1800));
  return diagnostics.heroToAct === true && diagnostics.actions.length >= 2 && age <= freshnessWindow;
}

function heroTurnSignal(machine) {
  const local = Boolean(machine?.state?.heroToAct || uiHeroTurn());
  if (local) return true;

  // Once a fast response captured after this turn started explicitly says Hero
  // is no longer to act, that fresh decision frame overrides a slower/stale
  // full-table heroToAct=true and ends the turn immediately.
  if (lastHeroTurn && turnSignalStartedAt > 0 && diagnostics.lastSeenAt >= turnSignalStartedAt && diagnostics.heroToAct === false) return false;

  return fastFrameStillHeroTurn(machine) || fullFrameHeroTurn(machine);
}

function resetCandidate() {
  candidateKey = '';
  candidateHits = 0;
  diagnostics.rawStableFrames = 0;
  diagnostics.publicPrepared = false;
  diagnostics.publicPreparedAt = 0;
  settledResponses.clear();
}

function startTurn() {
  generation++;
  turnSignalStartedAt = now();
  seq = 0;
  lastAppliedSeq = 0;
  lastCaptureAt = 0;
  nextRetryAt = 0;
  burstRemaining = 2;
  resetCandidate();
  diagnostics.trusted = false;
  diagnostics.lastSeenAt = 0;
  diagnostics.lastSuccessAt = 0;
  diagnostics.heroToAct = null;
  diagnostics.lastError = null;
  diagnostics.consecutiveFailures = 0;
  diagnostics.actions = [];
  diagnostics.aggressorName = null;
  diagnostics.aggressorCommitted = null;
  diagnostics.heroCommitted = null;
  diagnostics.trustReason = 'Sua vez · IA rápida pré-lendo a mesa pública.';
  renderDecisionReadout();
}

function endTurn() {
  generation++;
  turnSignalStartedAt = 0;
  resetCandidate();
  diagnostics.trusted = false;
  diagnostics.heroToAct = false;
  diagnostics.lastError = null;
  diagnostics.consecutiveFailures = 0;
  diagnostics.trustReason = 'Aguardando decisão do Hero.';
  diagnostics.actions = [];
  diagnostics.aggressorName = null;
  burstRemaining = 0;
  nextRetryAt = 0;
  renderDecisionReadout();
}

function resetHand(handId) {
  generation++;
  turnSignalStartedAt = 0;
  diagnostics.handId = handId;
  diagnostics.trusted = false;
  diagnostics.lastSeenAt = 0;
  diagnostics.lastSuccessAt = 0;
  diagnostics.heroToAct = false;
  diagnostics.actions = [];
  diagnostics.aggressorName = null;
  diagnostics.lastError = null;
  diagnostics.consecutiveFailures = 0;
  diagnostics.trustReason = 'Aguardando decisão do Hero.';
  seq = 0;
  lastAppliedSeq = 0;
  lastCaptureAt = 0;
  nextRetryAt = 0;
  burstRemaining = 0;
  lastHeroTurn = false;
  resetCandidate();
  renderDecisionReadout();
}

function noteFailure(reason) {
  const t = now();
  diagnostics.failures++;
  diagnostics.consecutiveFailures++;
  const recentGood = diagnostics.lastSuccessAt > 0 && t - diagnostics.lastSuccessAt <= 9000;
  const persistent = recentGood ? diagnostics.consecutiveFailures >= 3 : diagnostics.consecutiveFailures >= 2;
  if (persistent) {
    diagnostics.lastError = reason;
    if (!recentGood) diagnostics.trusted = false;
    diagnostics.trustReason = recentGood
      ? 'IA rápida reconectando; a última decisão confirmada continua válida.'
      : 'IA rápida não concluiu duas leituras seguidas; tentando novamente.';
  } else {
    diagnostics.lastError = null;
    diagnostics.trustReason = recentGood
      ? 'Oscilação rápida de rede; mantendo a decisão já confirmada.'
      : 'Reconectando a leitura rápida…';
  }
  nextRetryAt = t + Math.min(5000, 500 * (2 ** Math.min(3, diagnostics.consecutiveFailures - 1)));
  renderDecisionReadout();
}

function evaluateTrust({ hadTrusted = false, oldActionsKey = '' } = {}) {
  const machine = activeHandMachine;
  if (!machine || Number(diagnostics.handId) !== Number(machine.handId)) return false;

  const manualHero = manualHeroCards(machine);
  diagnostics.hero = manualHero;
  diagnostics.heroConfidence = manualHero.length === 2 ? 1 : 0;

  const stateHero = machine.state.hero || [];
  const stateBoard = machine.state.board || [];
  const statePot = Number(machine.state.pot);
  const heroOk = diagnostics.hero.length === 2 && exactCards(stateHero, diagnostics.hero);
  const boardOk = [0, 3, 4, 5].includes(diagnostics.board.length) && exactCards(stateBoard, diagnostics.board);
  const potOk = Number.isFinite(diagnostics.pot) && closeMoney(statePot, diagnostics.pot);
  const call = diagnostics.actions.find((a) => a.type === 'call');
  const actionAmountsOk = !call || Number.isFinite(call.amount);
  const turnConfirmed = diagnostics.heroToAct === true || diagnostics.actions.length >= 2;
  const actionsOk = turnConfirmed && diagnostics.actions.length >= 2 && diagnostics.actionsConfidence >= 0.78 && actionAmountsOk;
  const publicConfidenceOk = diagnostics.confidence >= 0.84 && diagnostics.boardConfidence >= 0.78 && diagnostics.potConfidence >= 0.84;
  const stableFrames = Number(diagnostics.rawStableFrames) || 0;
  const trustedNow = Boolean(stableFrames >= 2 && heroOk && boardOk && potOk && actionsOk && publicConfidenceOk);
  const sameActions = oldActionsKey && oldActionsKey === actionKey(diagnostics.actions);

  diagnostics.publicPrepared = Boolean(stableFrames >= 2 && boardOk && potOk && actionsOk && publicConfidenceOk);
  if (diagnostics.publicPrepared && !diagnostics.publicPreparedAt) diagnostics.publicPreparedAt = diagnostics.lastSeenAt || now();

  diagnostics.trusted = trustedNow || Boolean(hadTrusted && heroOk && boardOk && potOk && stableFrames >= 2 && (sameActions || diagnostics.actionsConfidence < 0.78));
  if (diagnostics.trusted) diagnostics.trustReason = diagnostics.publicPrepared
    ? '✓ Mesa pública já estava pronta 2/2; Hero manual encaixado.'
    : '✓ Decisão atual confirmada em duas leituras iguais + Hero manual.';
  else if (stableFrames < 2) diagnostics.trustReason = `Pré-lendo a mesa pública (${stableFrames}/2).`;
  else if (!heroOk) diagnostics.trustReason = '✓ Mesa pública pronta 2/2 · aguardando somente suas duas cartas manuais.';
  else if (!boardOk) diagnostics.trustReason = 'IA rápida ainda confirmando board/street.';
  else if (!potOk) diagnostics.trustReason = 'IA rápida ainda confirmando o pote atual.';
  else if (!actionsOk) diagnostics.trustReason = 'IA rápida ainda confirmando CHECK/CALL/RAISE e valores.';
  else diagnostics.trustReason = 'IA rápida com confiança pública abaixo do limite.';

  return diagnostics.trusted;
}

function bindManualHeroToPreparedSnapshot() {
  const machine = activeHandMachine;
  if (!machine || machine.handId <= 0) return false;
  const manualHero = manualHeroCards(machine);
  if (manualHero.length !== 2) return false;

  const wasTrusted = Boolean(diagnostics.trusted);
  const ready = evaluateTrust({ hadTrusted: wasTrusted, oldActionsKey: actionKey(diagnostics.actions) });
  if (ready && !wasTrusted) diagnostics.heroLateBindings++;
  renderDecisionReadout();
  return ready;
}

function apply(out) {
  const machine = activeHandMachine;
  if (!machine || out.handId !== machine.handId) return;
  const hadTrusted = diagnostics.trusted;
  const oldActionsKey = actionKey(diagnostics.actions);

  diagnostics.responses++;
  diagnostics.handId = out.handId;
  diagnostics.lastSeenAt = now();
  diagnostics.lastSuccessAt = diagnostics.lastSeenAt;
  diagnostics.lastLatencyMs = Number(out.ms) || null;
  diagnostics.confidence = Number(out.confidence) || 0;
  diagnostics.boardConfidence = Number(out.boardConfidence) || 0;
  diagnostics.potConfidence = Number(out.potConfidence) || 0;
  diagnostics.actionsConfidence = Number(out.actionsConfidence) || 0;
  diagnostics.aggressorConfidence = Number(out.aggressorConfidence) || 0;
  diagnostics.board = Array.isArray(out.board) ? out.board.map((c) => ({ ...c })) : [];
  diagnostics.pot = Number.isFinite(out.pot) ? out.pot : null;
  diagnostics.heroToAct = typeof out.heroToAct === 'boolean' ? out.heroToAct : null;
  diagnostics.aggressorName = out.aggressorName || null;
  diagnostics.aggressorCommitted = Number.isFinite(out.aggressorCommitted) ? out.aggressorCommitted : null;
  diagnostics.heroCommitted = Number.isFinite(out.heroCommitted) ? out.heroCommitted : null;
  diagnostics.actions = fillDerivedCall(out.heroActions, diagnostics.aggressorCommitted, diagnostics.heroCommitted);
  diagnostics.lastError = null;
  diagnostics.consecutiveFailures = 0;
  nextRetryAt = 0;

  observeCandidate();
  commitCritical(out);
  evaluateTrust({ hadTrusted, oldActionsKey });
  renderDecisionReadout();
}

function ensureDecisionReadout() {
  let box = document.getElementById('decisionVisionR14');
  if (box) return box;
  const coach = document.querySelector('.coach-card');
  if (!coach) return null;
  box = document.createElement('div');
  box.id = 'decisionVisionR14';
  box.className = 'decision-vision-r14';
  box.innerHTML = '<span class="eyebrow">DECISÃO IA · RÁPIDA</span><strong id="decisionVisionTitle">Aguardando sua vez.</strong><div id="decisionVisionDetail"></div>';
  const full = document.getElementById('tableVisionR14');
  if (full) full.insertAdjacentElement('beforebegin', box);
  else {
    const actions = document.getElementById('actions');
    if (actions) actions.insertAdjacentElement('afterend', box); else coach.append(box);
  }
  if (!document.getElementById('decisionVisionR14Styles')) {
    const style = document.createElement('style');
    style.id = 'decisionVisionR14Styles';
    style.textContent = '.decision-vision-r14{margin-top:10px;border:1px solid #315044;border-radius:10px;background:#0b1511;padding:10px}.decision-vision-r14>strong{display:block;margin-top:5px;font-size:12px}.decision-vision-r14 #decisionVisionDetail{margin-top:5px;font-size:10px;color:#9eaaa6}.decision-vision-r14.ok{border-color:#3d7c5f}.decision-vision-r14.ok #decisionVisionDetail{color:#63d49a}';
    document.head.appendChild(style);
  }
  return box;
}

function renderDecisionReadout() {
  const box = ensureDecisionReadout();
  if (!box) return;
  const title = document.getElementById('decisionVisionTitle');
  const detail = document.getElementById('decisionVisionDetail');
  if (!title || !detail) return;
  box.className = `decision-vision-r14${diagnostics.trusted ? ' ok' : ''}`;

  const machine = activeHandMachine;
  const heroTurn = machine ? heroTurnSignal(machine) : false;
  if (!heroTurn) {
    title.textContent = 'Aguardando sua vez.';
    detail.textContent = 'A leitura rápida só dispara quando existe uma decisão do Hero.';
    return;
  }
  if (!diagnostics.lastSeenAt) {
    title.textContent = diagnostics.lastError ? `Reconectando · ${diagnostics.lastError}` : 'Pré-lendo a decisão atual…';
    detail.textContent = diagnostics.trustReason;
    return;
  }

  const actions = diagnostics.actions.map((a) => `${String(a.type).toUpperCase()}${Number.isFinite(a.amount) ? ` ${fmt(a.amount)}` : ''}`).join(' · ');
  const prepared = diagnostics.publicPrepared && manualHeroCards(machine).length !== 2 ? ' · MESA PRONTA' : '';
  title.textContent = `${diagnostics.trusted ? '✓ ' : ''}IA rápida ${Math.round(diagnostics.confidence * 100)}%${Number.isFinite(diagnostics.lastLatencyMs) ? ` · ${diagnostics.lastLatencyMs}ms` : ''} · ${diagnostics.rawStableFrames}/2${prepared}`;
  detail.textContent = `${actions || 'ações pendentes'}${diagnostics.aggressorName ? ` · agressor ${diagnostics.aggressorName}` : ''}${diagnostics.consecutiveFailures ? ' · reconectando' : ''}`;
}

function flushSettledResponses(localGeneration) {
  if (localGeneration !== generation) return;
  while (settledResponses.has(lastAppliedSeq + 1)) {
    const nextSeq = lastAppliedSeq + 1;
    const out = settledResponses.get(nextSeq);
    settledResponses.delete(nextSeq);
    lastAppliedSeq = nextSeq;
    if (out) apply(out);
  }
}

async function requestFrame(localSeq, canvas, handId, localGeneration) {
  diagnostics.inFlight++;
  diagnostics.requests++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7600);
  try {
    const image = canvas.toDataURL('image/jpeg', 0.70);
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
      noteFailure(reason);
      settledResponses.set(localSeq, null);
      flushSettledResponses(localGeneration);
      return;
    }
    const out = await r.json();
    if (localGeneration !== generation || localSeq <= lastAppliedSeq) return;
    settledResponses.set(localSeq, out);
    flushSettledResponses(localGeneration);
  } catch (e) {
    if (localGeneration !== generation) return;
    noteFailure(e?.name === 'AbortError' ? 'timeout da IA rápida' : 'falha transitória de rede');
    settledResponses.set(localSeq, null);
    flushSettledResponses(localGeneration);
  } finally {
    clearTimeout(timer);
    diagnostics.inFlight = Math.max(0, diagnostics.inFlight - 1);
    renderDecisionReadout();
  }
}

function tick() {
  const machine = activeHandMachine;
  const source = visibleSource();
  if (!machine || !source || machine.handId <= 0) return;
  if (diagnostics.handId !== machine.handId) resetHand(machine.handId);

  const heroTurn = heroTurnSignal(machine);
  if (heroTurn && !lastHeroTurn) startTurn();
  if (!heroTurn) {
    if (lastHeroTurn) endTurn();
    lastHeroTurn = false;
    renderDecisionReadout();
    return;
  }
  lastHeroTurn = true;

  const t = now();
  if (t < nextRetryAt) return;
  const initialBurst = burstRemaining > 0;
  const maxInFlight = initialBurst ? 2 : 1;
  const interval = initialBurst ? 120 : diagnostics.trusted ? 2600 : diagnostics.publicPrepared ? 1200 : 450;
  if (diagnostics.inFlight >= maxInFlight || t - lastCaptureAt < interval) return;

  const canvas = snapshot(source);
  if (!canvas) return;
  lastCaptureAt = t;
  if (burstRemaining > 0) burstRemaining--;
  const localSeq = ++seq;
  void requestFrame(localSeq, canvas, machine.handId, generation);
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', (e) => resetHand(Number(e.detail?.generation) || activeHandMachine?.handId || 0));
  window.addEventListener('prc:manual-state-applied', (e) => {
    if (!e.detail?.hero || Number(e.detail.generation) !== Number(activeHandMachine?.handId)) return;
    // No new network round-trip: attach Hero to the already prepared public
    // snapshot and let resolver-runtime publish on its next 45ms tick.
    bindManualHeroToPreparedSnapshot();
  });
  window.__prcAIDecisionRefreshR14 = () => {
    lastCaptureAt = 0;
    nextRetryAt = 0;
    burstRemaining = 2;
    resetCandidate();
    diagnostics.trusted = false;
    diagnostics.lastError = null;
    diagnostics.consecutiveFailures = 0;
    tick();
  };
}

setInterval(tick, 100);
setTimeout(() => { ensureDecisionReadout(); tick(); }, 220);
