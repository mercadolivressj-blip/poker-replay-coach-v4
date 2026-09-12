import { setDecisionGate } from '../core/decision-store.js';
import { activeHandMachine } from '../core/state-machine.js';

const STRATEGIC = new Set(['PAGAR','DESISTIR','PASSAR','APOSTAR','AUMENTAR','ALL-IN']);

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function cardId(c) {
  return c?.rank && c?.suit ? `${String(c.rank).toUpperCase()}${String(c.suit)}` : '?';
}

function cardsKey(cards) {
  return Array.isArray(cards) ? cards.map(cardId).join(',') : '';
}

function exactCards(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && cardsKey(a) === cardsKey(b);
}

function closeMoney(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.018);
}

function manualHeroReady() {
  const machine = activeHandMachine;
  const authority = typeof window !== 'undefined' ? window.__prcManualHeroAuthorityR14 : null;
  const hero = machine?.state?.hero || [];
  return Boolean(
    machine?.handId > 0
    && authority?.manualOnly
    && authority?.heroLocked
    && Number(authority.handId) === machine.handId
    && hero.length === 2
    && hero.every((card) => card?.rank && card?.suit)
  );
}

function machineMatchesDecision(d) {
  const machine = activeHandMachine;
  if (!machine || machine.handId <= 0 || !manualHeroReady()) return false;
  const board = machine.state?.board || [];
  const pot = Number(machine.state?.pot);
  return exactCards(board, d?.board || [])
    && closeMoney(pot, Number(d?.pot));
}

function decisionTrust() {
  const d = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;
  const machine = activeHandMachine;
  const t = nowMs();
  const age = Number.isFinite(Number(d?.lastSeenAt)) && Number(d.lastSeenAt) > 0 ? t - Number(d.lastSeenAt) : Infinity;
  const latency = Math.max(0, Number(d?.lastLatencyMs) || 0);
  const freshnessWindow = Math.max(5000, Math.min(9000, latency * 2 + 1800));
  const sameHand = machine?.handId > 0 && Number(d?.handId) === machine.handId;
  const heroReady = manualHeroReady();
  const coreMatches = machineMatchesDecision(d);
  const stableFrames = Number(d?.stableDecisionFrames) || 0;
  const actions = Array.isArray(d?.actions) ? d.actions : [];
  const hasPricedCall = !actions.some((a) => a?.type === 'call') || actions.some((a) => a?.type === 'call' && Number.isFinite(a?.amount));
  const trusted = Boolean(d?.trusted)
    && heroReady
    && stableFrames >= 2
    && sameHand
    && coreMatches
    && age <= freshnessWindow
    && actions.length >= 2
    && hasPricedCall;

  return {
    trusted,
    heroReady,
    reason: heroReady ? (d?.trustReason || 'A IA rápida ainda não confirmou a decisão atual.') : 'Informe suas duas cartas manualmente para liberar a decisão.',
    age,
    freshnessWindow,
    confidence: Number(d?.confidence) || 0,
    latency,
    actions: actions.length,
    stableFrames,
    aggressorName: d?.aggressorName || null,
    error: d?.lastError || null,
  };
}

setDecisionGate((entry) => {
  if (!entry || !STRATEGIC.has(entry.decision)) return entry;

  const fast = decisionTrust();
  if (fast.trusted) return entry;

  const reason = !fast.heroReady
    ? 'Informe suas duas cartas manualmente para liberar a decisão.'
    : fast.error
      ? `IA rápida indisponível: ${fast.error}`
      : fast.reason || 'A decisão atual ainda não fechou duas leituras iguais.';
  const age = Number.isFinite(fast.age) ? `${Math.round(fast.age)}ms atrás` : 'sem leitura rápida válida';

  return {
    ...entry,
    decision: 'LEITURA INSUFICIENTE',
    reason,
    details: `Segurança de estudo · Hero manual ${fast.heroReady ? 'OK' : 'pendente'} · snapshot rápido ${fast.stableFrames}/2 · confiança ${Math.round(fast.confidence * 100)}% · ${fast.actions} ações atuais · ${fast.aggressorName ? `agressor ${fast.aggressorName}` : 'agressor pendente'} · ${age}. A mesa pode ser pré-lida antes das cartas; a estratégia só sai depois das cartas manuais.`,
    confidence: 0,
    source: 'study-safety-gate-ai-r14',
  };
});

if (typeof window !== 'undefined') {
  window.__prcStudySafetyGateR14 = {
    enabled: true,
    requires: ['manual-hero','ai-decision-frame-consensus'],
    stableDecisionFrames: 2,
    finalDecisionFrozenUntilHeroActs: true,
  };
}
