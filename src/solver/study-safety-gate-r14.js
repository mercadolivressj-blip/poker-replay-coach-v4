import { setDecisionGate } from '../core/decision-store.js';
import { activeHandMachine } from '../core/state-machine.js';

const STRATEGIC = new Set(['PAGAR','DESISTIR','PASSAR','APOSTAR','AUMENTAR','ALL-IN']);
let lastValidated = null;

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

function machineMatchesAI(aiHero, aiBoard, aiPot) {
  const machine = activeHandMachine;
  if (!machine || machine.handId <= 0) return false;
  const hero = machine.state?.hero || [];
  const board = machine.state?.board || [];
  const pot = Number(machine.state?.pot);
  return exactCards(hero, aiHero) && exactCards(board, aiBoard) && closeMoney(pot, Number(aiPot));
}

function decisionTrust() {
  const d = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;
  const machine = activeHandMachine;
  const t = nowMs();
  const age = Number.isFinite(Number(d?.lastSeenAt)) && Number(d.lastSeenAt) > 0 ? t - Number(d.lastSeenAt) : Infinity;
  const latency = Math.max(0, Number(d?.lastLatencyMs) || 0);
  const freshnessWindow = Math.max(4500, Math.min(9000, latency * 2 + 1800));
  const sameHand = machine?.handId > 0 && Number(d?.handId) === machine.handId;
  const coreMatches = machineMatchesAI(d?.hero || [], d?.board || [], d?.pot);
  const trusted = Boolean(d?.trusted) && sameHand && coreMatches && age <= freshnessWindow;
  return {
    trusted,
    reason: d?.trustReason || 'A IA rápida ainda não confirmou a decisão atual.',
    age,
    freshnessWindow,
    confidence: Number(d?.confidence) || 0,
    latency,
    actions: Array.isArray(d?.actions) ? d.actions.length : 0,
    aggressorName: d?.aggressorName || null,
    error: d?.lastError || null,
  };
}

function rememberValidated(d, t) {
  const machine = activeHandMachine;
  if (!machine || machine.handId <= 0) return;
  lastValidated = {
    handId: machine.handId,
    hero: Array.isArray(d?.hero) ? d.hero.map((c) => ({ ...c })) : [],
    board: Array.isArray(d?.board) ? d.board.map((c) => ({ ...c })) : [],
    pot: Number.isFinite(Number(d?.pot)) ? Number(d.pot) : null,
    seenAt: t,
    confidence: Number(d?.confidence) || 0,
    seats: Array.isArray(d?.seats) ? d.seats.length : 0,
  };
}

function aiTrust() {
  const d = typeof window !== 'undefined' ? window.__prcAIStateR14 : null;
  const t = nowMs();
  const age = Number.isFinite(Number(d?.lastSeenAt)) && Number(d.lastSeenAt) > 0 ? t - Number(d.lastSeenAt) : Infinity;
  const latency = Math.max(0, Number(d?.lastLatencyMs) || 0);
  const freshnessWindow = Math.max(9000, Math.min(15000, latency * 2 + 2500));
  const confidence = Number(d?.confidence) || 0;
  const seatsConfidence = Number(d?.seatsConfidence) || 0;
  const seats = Array.isArray(d?.seats) ? d.seats.length : 0;
  const stableFrames = Number(d?.stableFrames) || 0;
  const error = d?.lastError || null;
  const coreMatches = machineMatchesAI(d?.hero || [], d?.board || [], d?.pot);

  const directTrusted = Boolean(d?.trusted) && age <= freshnessWindow && coreMatches;
  const strongCoreFrame = age <= freshnessWindow
    && coreMatches
    && stableFrames >= 1
    && confidence >= 0.92
    && seatsConfidence >= 0.86
    && seats >= 2;

  if (directTrusted || strongCoreFrame) rememberValidated(d, t);

  const machine = activeHandMachine;
  const stickyAge = lastValidated ? t - lastValidated.seenAt : Infinity;
  const stickyTrusted = Boolean(lastValidated)
    && machine?.handId === lastValidated.handId
    && stickyAge <= freshnessWindow
    && machineMatchesAI(lastValidated.hero, lastValidated.board, lastValidated.pot);

  const trusted = directTrusted || strongCoreFrame || stickyTrusted;
  let reason = d?.trustReason || 'A IA ainda não validou o frame inteiro.';
  if (stickyTrusted && !directTrusted && !strongCoreFrame) reason = '✓ Mantendo a última leitura confirmada enquanto a visão reconecta.';
  else if (strongCoreFrame && !directTrusted) reason = '✓ Estado principal confirmado; variação de assentos/rede não bloqueia o solver.';

  return { trusted, reason, age, freshnessWindow, stableFrames, confidence, seats, error };
}

setDecisionGate((entry) => {
  if (!entry || !STRATEGIC.has(entry.decision)) return entry;

  const fast = decisionTrust();
  if (fast.trusted) return entry;

  const ai = aiTrust();
  if (ai.trusted) return entry;

  const reason = fast.error
    ? `IA rápida indisponível: ${fast.error}`
    : fast.reason || ai.reason;
  const age = Number.isFinite(fast.age) ? `${Math.round(fast.age)}ms atrás` : 'sem leitura rápida válida';

  return {
    ...entry,
    decision: 'LEITURA INSUFICIENTE',
    reason,
    details: `Segurança de estudo ativa · decisão IA ${Math.round(fast.confidence * 100)}% · ${fast.actions} ações atuais · ${fast.aggressorName ? `agressor ${fast.aggressorName}` : 'agressor pendente'} · ${age}. Falha transitória de rede não invalida uma leitura já confirmada; o bloqueio volta apenas quando o estado público muda ou a leitura expira.`,
    confidence: 0,
    source: 'study-safety-gate-ai-r14',
  };
});

if (typeof window !== 'undefined') {
  window.__prcStudySafetyGateR14 = {
    enabled: true,
    requires: ['ai-decision-frame', 'ai-full-frame-fallback'],
    stickyValidatedState: true,
  };
}
