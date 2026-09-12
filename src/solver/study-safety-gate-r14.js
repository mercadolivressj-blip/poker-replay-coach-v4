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
  // The vision call itself is often 4-6s. Never expire a good read before the next read can realistically finish.
  const freshnessWindow = Math.max(9000, Math.min(15000, latency * 2 + 2500));
  const confidence = Number(d?.confidence) || 0;
  const seatsConfidence = Number(d?.seatsConfidence) || 0;
  const seats = Array.isArray(d?.seats) ? d.seats.length : 0;
  const stableFrames = Number(d?.stableFrames) || 0;
  const error = d?.lastError || null;
  const coreMatches = machineMatchesAI(d?.hero || [], d?.board || [], d?.pot);

  // Normal full trust from the AI runtime.
  const directTrusted = Boolean(d?.trusted) && age <= freshnessWindow && coreMatches;

  // If Hero/board/pot are already synchronized and the current whole-frame read is very strong,
  // do not block strategy merely because seat indexing/nickname structure fell back to 1/2.
  const strongCoreFrame = !error
    && age <= freshnessWindow
    && coreMatches
    && stableFrames >= 1
    && confidence >= 0.92
    && seatsConfidence >= 0.86
    && seats >= 2;

  if (directTrusted || strongCoreFrame) rememberValidated(d, t);

  // Keep the last validated state sticky while the next slow AI call is in flight.
  // This is allowed ONLY while the deterministic hand state still matches the exact
  // Hero/board/pot that were validated. Any real public-state change breaks the latch immediately.
  const machine = activeHandMachine;
  const stickyAge = lastValidated ? t - lastValidated.seenAt : Infinity;
  const stickyTrusted = !error
    && Boolean(lastValidated)
    && machine?.handId === lastValidated.handId
    && stickyAge <= freshnessWindow
    && machineMatchesAI(lastValidated.hero, lastValidated.board, lastValidated.pot);

  const trusted = directTrusted || strongCoreFrame || stickyTrusted;
  let reason = d?.trustReason || 'A IA ainda não validou o frame inteiro.';
  if (stickyTrusted && !directTrusted && !strongCoreFrame) {
    reason = '✓ Mantendo a última leitura confirmada enquanto a próxima leitura da IA termina.';
  } else if (strongCoreFrame && !directTrusted) {
    reason = '✓ Estado principal confirmado; variação de assentos não bloqueia o solver.';
  }

  return {
    trusted,
    reason,
    age,
    freshnessWindow,
    responses: Number(d?.responses) || 0,
    stableFrames,
    confidence,
    seats,
    pot: Number.isFinite(Number(d?.pot)) ? Number(d.pot) : null,
    error,
    sticky: stickyTrusted,
    strongCoreFrame,
  };
}

setDecisionGate((entry) => {
  if (!entry || !STRATEGIC.has(entry.decision)) return entry;
  const ai = aiTrust();
  if (ai.trusted) return entry;

  const freshness = Number.isFinite(ai.age) ? `${Math.round(ai.age)}ms atrás` : 'sem leitura válida';
  const reason = ai.error
    ? `IA de visão indisponível: ${ai.error}`
    : ai.reason;

  return {
    ...entry,
    decision: 'LEITURA INSUFICIENTE',
    reason,
    details: `Segurança de estudo ativa · IA full-frame ${Math.round(ai.confidence * 100)}% · ${ai.seats} assentos · ${ai.stableFrames}/2 confirmações · ${freshness}. O solver só bloqueia quando Hero/board/pote ainda não foram validados ou quando o estado público realmente mudou.`,
    confidence: 0,
    source: 'study-safety-gate-ai-r14',
  };
});

if (typeof window !== 'undefined') {
  window.__prcStudySafetyGateR14 = {
    enabled: true,
    requires: ['ai-full-frame'],
    stickyValidatedState: true,
  };
}
