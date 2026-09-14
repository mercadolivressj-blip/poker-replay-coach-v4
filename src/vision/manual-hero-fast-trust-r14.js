import { activeHandMachine } from '../core/state-machine.js';

const diagnostics = {
  enabled: true,
  restores: 0,
  revokes: 0,
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
    && Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.02);
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

function decisionEvidence(machine, d) {
  if (!machine || !d || Number(d.handId) !== Number(machine.handId)) {
    return { trusted: false, reason: 'hand-mismatch' };
  }
  if (!manualHeroReady(machine)) return { trusted: false, reason: 'manual-hero-pending' };

  const board = machine.state?.board || [];
  const boardOk = [0, 3, 4, 5].includes((d.board || []).length) && exactCards(board, d.board || []);
  if (!boardOk) return { trusted: false, reason: 'board-mismatch' };

  const statePot = Number(machine.state?.pot);
  const potOk = Number.isFinite(d.pot) && closeMoney(statePot, Number(d.pot));
  if (!potOk) return { trusted: false, reason: 'pot-mismatch' };

  const actions = Array.isArray(d.actions) ? d.actions : [];
  const call = actions.find((action) => action?.type === 'call');
  const pricedCall = !call || Number.isFinite(call.amount);
  const actionsOk = (d.heroToAct === true || actions.length >= 2)
    && actions.length >= 2
    && Number(d.actionsConfidence) >= 0.78
    && pricedCall;
  if (!actionsOk) return { trusted: false, reason: 'actions-pending' };

  if (Number(d.rawStableFrames) < 2) return { trusted: false, reason: 'raw-consensus-pending' };

  const confidenceOk = Number(d.confidence) >= 0.84
    && Number(d.boardConfidence) >= 0.78
    && Number(d.potConfidence) >= 0.84;
  if (!confidenceOk) return { trusted: false, reason: 'confidence-low' };

  const age = Number.isFinite(Number(d.lastSeenAt)) && Number(d.lastSeenAt) > 0
    ? nowMs() - Number(d.lastSeenAt)
    : Infinity;
  const latency = Math.max(0, Number(d.lastLatencyMs) || 0);
  const freshnessWindow = Math.max(5000, Math.min(9000, latency * 2 + 1800));
  if (age > freshnessWindow) return { trusted: false, reason: 'decision-stale' };

  return { trusted: true, reason: 'manual-hero-plus-public-decision-2of2' };
}

function tick() {
  if (typeof window === 'undefined') return;
  const d = window.__prcAIDecisionR14;
  const machine = activeHandMachine;
  if (!d || !machine) return;

  const evidence = decisionEvidence(machine, d);
  diagnostics.lastReason = evidence.reason;

  if (evidence.trusted) {
    if (!d.trusted) diagnostics.restores++;
    d.trusted = true;
    d.trustReason = '✓ Hero manual + board, pote e ações atuais confirmados em duas leituras iguais.';
    return;
  }

  if (d.trusted && ['hand-mismatch','manual-hero-pending','board-mismatch','pot-mismatch','decision-stale'].includes(evidence.reason)) {
    diagnostics.revokes++;
    d.trusted = false;
  }
}

if (typeof window !== 'undefined') {
  window.__prcManualHeroFastTrustR14 = diagnostics;
  window.addEventListener('prc:generation-change', () => {
    diagnostics.lastReason = 'generation-change';
  });
  setInterval(tick, 35);
  setTimeout(tick, 0);
}

export { decisionEvidence };
