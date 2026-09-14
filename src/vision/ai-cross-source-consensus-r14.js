import { activeHandMachine } from '../core/state-machine.js';

const diagnostics = {
  enabled: true,
  promotions: 0,
  rejects: 0,
  lastReason: 'boot',
};

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function cardId(card) {
  return card?.rank && card?.suit ? `${String(card.rank).toUpperCase()}:${String(card.suit)}` : '?';
}

function exactCards(a, b) {
  return Array.isArray(a)
    && Array.isArray(b)
    && a.length === b.length
    && a.map(cardId).join(',') === b.map(cardId).join(',');
}

function closeMoney(a, b) {
  return Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.04);
}

function manualHeroReady(machine) {
  const authority = typeof window !== 'undefined' ? window.__prcManualHeroAuthorityR14 : null;
  const hero = machine?.state?.hero || [];
  return Boolean(
    machine?.handId > 0
    && authority?.manualOnly
    && authority?.heroLocked
    && Number(authority.handId) === Number(machine.handId)
    && hero.length === 2
    && hero.every((card) => card?.rank && card?.suit)
  );
}

function actionTypes(actions) {
  return [...new Set((actions || []).map((action) => String(action?.type || '')).filter(Boolean))].sort();
}

function sameActionTypes(a, b) {
  const aa = actionTypes(a);
  const bb = actionTypes(b);
  return aa.length >= 2 && aa.length === bb.length && aa.every((type, index) => type === bb[index]);
}

function freshness(source, maxFloor = 6000) {
  const seen = Number(source?.lastSeenAt) || 0;
  if (!seen) return false;
  const latency = Math.max(0, Number(source?.lastLatencyMs) || 0);
  const windowMs = Math.max(maxFloor, Math.min(10000, latency * 2 + 2200));
  return nowMs() - seen <= windowMs;
}

function evidence() {
  if (typeof window === 'undefined') return { trusted: false, reason: 'no-window' };
  const machine = activeHandMachine;
  const fast = window.__prcAIDecisionR14;
  const full = window.__prcAIStateR14;
  if (!machine || !fast || !full || machine.handId <= 0) return { trusted: false, reason: 'missing-runtime' };
  if (!manualHeroReady(machine)) return { trusted: false, reason: 'manual-hero-pending' };
  if (Number(fast.handId) !== Number(machine.handId) || Number(full.handId) !== Number(machine.handId)) return { trusted: false, reason: 'hand-mismatch' };
  if (!freshness(fast, 5200) || !freshness(full, 7000)) return { trusted: false, reason: 'stale-source' };

  const board = machine.state?.board || [];
  const statePot = Number(machine.state?.pot);
  const fastBoardOk = exactCards(board, fast.board || []);
  const fullBoardOk = exactCards(board, full.board || []);
  const fastPotOk = Number.isFinite(fast.pot) && closeMoney(statePot, Number(fast.pot));
  const fullPotOk = Number.isFinite(full.pot) && closeMoney(statePot, Number(full.pot));
  if (!fastBoardOk || !fullBoardOk) return { trusted: false, reason: 'board-disagreement' };
  if (!fastPotOk || !fullPotOk) return { trusted: false, reason: 'pot-disagreement' };

  const fastActions = Array.isArray(fast.actions) ? fast.actions : [];
  const localActions = Array.isArray(machine.state?.actions) ? machine.state.actions : [];
  const call = fastActions.find((action) => action?.type === 'call');
  const pricedCall = !call || Number.isFinite(call.amount);
  const localAgreement = localActions.length >= 2 ? sameActionTypes(fastActions, localActions) : false;
  if (fastActions.length < 2 || !pricedCall || !localAgreement) return { trusted: false, reason: 'actions-not-cross-checked' };

  const fastStrong = Number(fast.confidence) >= 0.92
    && Number(fast.boardConfidence) >= 0.82
    && Number(fast.potConfidence) >= 0.86
    && Number(fast.actionsConfidence) >= 0.86;
  const fullStrong = full.trusted === true
    && Number(full.confidence) >= 0.90
    && Number(full.seatsConfidence) >= 0.80;
  if (!fastStrong || !fullStrong) return { trusted: false, reason: 'confidence-not-strong-enough' };

  return { trusted: true, reason: 'fast-1x-plus-full-frame-plus-local-actions' };
}

function tick() {
  if (typeof window === 'undefined') return;
  const fast = window.__prcAIDecisionR14;
  if (!fast) return;

  const result = evidence();
  diagnostics.lastReason = result.reason;
  if (!result.trusted) {
    diagnostics.rejects++;
    return;
  }

  const alreadyPromoted = Number(fast.rawStableFrames) >= 2
    && Number(fast.stableDecisionFrames) >= 2
    && fast.trusted === true;
  if (alreadyPromoted) return;

  fast.rawStableFrames = Math.max(2, Number(fast.rawStableFrames) || 0);
  fast.stableDecisionFrames = Math.max(2, Number(fast.stableDecisionFrames) || 0);
  fast.publicPrepared = true;
  if (!fast.publicPreparedAt) fast.publicPreparedAt = fast.lastSeenAt || nowMs();
  fast.trusted = true;
  fast.trustReason = '✓ Consenso cruzado: IA rápida + frame inteiro + ações locais confirmam a mesma decisão.';
  fast.crossSourceConsensus = true;
  diagnostics.promotions++;
}

if (typeof window !== 'undefined') {
  window.__prcAICrossSourceConsensusR14 = diagnostics;
  window.addEventListener('prc:generation-change', () => {
    diagnostics.lastReason = 'generation-change';
  });
  setInterval(tick, 35);
  setTimeout(tick, 0);
}

export { evidence };
