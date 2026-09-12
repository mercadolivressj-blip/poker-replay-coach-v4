import { activeHandMachine } from '../core/state-machine.js';

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function cardId(card) {
  return card?.rank && card?.suit ? `${String(card.rank).toUpperCase()}:${String(card.suit)}` : '?';
}

function exactCards(a, b) {
  return Array.isArray(a)
    && Array.isArray(b)
    && a.length === b.length
    && a.every((card, index) => cardId(card) === cardId(b[index]));
}

function closeMoney(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.02);
}

function manualHeroReady() {
  const authority = window.__prcManualHeroAuthorityR14;
  const machine = activeHandMachine;
  const cards = machine?.state?.hero || [];
  return Boolean(
    authority?.heroLocked
    && authority.handId === machine?.handId
    && cards.length === 2
    && cards.every((card) => card?.rank && card?.suit)
  );
}

function promotePrefetchedDecision() {
  const machine = activeHandMachine;
  const d = window.__prcAIDecisionR14;
  if (!machine || !d || !manualHeroReady() || Number(d.handId) !== machine.handId) return false;

  const latency = Math.max(0, Number(d.lastLatencyMs) || 0);
  const freshnessWindow = Math.max(5000, Math.min(9000, latency * 2 + 1800));
  const age = Number(d.lastSeenAt) > 0 ? now() - Number(d.lastSeenAt) : Infinity;
  const actions = Array.isArray(d.actions) ? d.actions : [];
  const call = actions.find((action) => action?.type === 'call');
  const boardOk = exactCards(machine.state.board || [], d.board || []);
  const potOk = closeMoney(Number(machine.state.pot), Number(d.pot));
  const actionOk = actions.length >= 2
    && Number(d.actionsConfidence) >= 0.78
    && (!call || Number.isFinite(call.amount));
  const perceptionOk = Number(d.rawStableFrames) >= 2
    && Number(d.confidence) >= 0.84
    && Number(d.boardConfidence) >= 0.78
    && Number(d.potConfidence) >= 0.84
    && age <= freshnessWindow
    && boardOk
    && potOk
    && actionOk;

  if (!perceptionOk) {
    window.__prcAIDecisionRefreshR14?.();
    return false;
  }

  // Consensus was already earned for table/action state while the user was
  // entering Hero cards. Do not throw that work away just because Hero is manual.
  d.trusted = true;
  d.trustReason = '✓ Mesa e ação já estavam pré-lidas; cartas manuais aplicadas.';
  d.heroConfidence = 1;
  window.dispatchEvent(new CustomEvent('prc:manual-hero-prefetch-ready', {
    detail: { handId: machine.handId, ageMs: Math.round(age) },
  }));
  return true;
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:manual-state-applied', (event) => {
    if (!event.detail?.hero || Number(event.detail.generation) !== activeHandMachine?.handId) return;
    setTimeout(promotePrefetchedDecision, 0);
  });
  window.__prcPromoteManualHeroPrefetchR14 = promotePrefetchedDecision;
}
