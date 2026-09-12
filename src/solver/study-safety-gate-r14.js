import { setDecisionGate } from '../core/decision-store.js';
import { activeHandMachine } from '../core/state-machine.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';
import { classifyPreflopContext } from '../core/preflop-context-r14.js';

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

function streetForBoardCount(count) {
  return count === 3 ? 'flop' : count === 4 ? 'turn' : count === 5 ? 'river' : 'preflop';
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

function publicBoardTrust() {
  const machine = activeHandMachine;
  const publicLifecycle = typeof window !== 'undefined' ? window.__prcPublicLifecycleR14 : null;
  const life = typeof publicLifecycle?.view === 'function' ? publicLifecycle.view() : publicLifecycle;
  const t = nowMs();
  if (!machine || !life) return { trusted: false, reason: 'A leitura física do board ainda não iniciou.' };

  const age = Number.isFinite(Number(life.visualBoardUpdatedAt)) ? t - Number(life.visualBoardUpdatedAt) : Infinity;
  const physicalCount = Number(life.visualBoardCount);
  const physicalHits = Number(life.visualBoardHits) || 0;
  const logicalCount = Array.isArray(machine.state?.board) ? machine.state.board.length : 0;
  const logicalStreet = String(machine.state?.street || 'preflop');
  const expectedStreet = streetForBoardCount(logicalCount);
  const stable = [0,3,4,5].includes(physicalCount) && physicalHits >= 3 && age <= 1400;
  const transitioning = Boolean(life.heroGapArmed || life.boardClearArmed);
  const countMatches = stable && physicalCount === logicalCount;
  const streetMatches = logicalStreet === expectedStreet;
  const trusted = stable && !transitioning && countMatches && streetMatches;

  let reason = 'Board físico sincronizado.';
  if (!stable) reason = 'Aguardando confirmação física do board.';
  else if (transitioning) reason = 'Troca de mão detectada; invalidando o estado anterior.';
  else if (!countMatches) reason = `Board físico tem ${physicalCount} cartas, mas o estado ainda tem ${logicalCount}.`;
  else if (!streetMatches) reason = `Street ${logicalStreet} não corresponde ao board atual.`;

  return { trusted, reason, age, physicalCount, physicalHits, logicalCount, transitioning };
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
  const rawStableFrames = Number(d?.rawStableFrames) || 0;
  const actions = Array.isArray(d?.actions) ? d.actions : [];
  const hasPricedCall = !actions.some((a) => a?.type === 'call') || actions.some((a) => a?.type === 'call' && Number.isFinite(a?.amount));
  const publicBoard = publicBoardTrust();
  const trusted = Boolean(d?.trusted)
    && heroReady
    && rawStableFrames >= 2
    && stableFrames >= 2
    && sameHand
    && coreMatches
    && publicBoard.trusted
    && age <= freshnessWindow
    && actions.length >= 2
    && hasPricedCall;

  let reason = heroReady ? (d?.trustReason || 'A IA rápida ainda não confirmou a decisão atual.') : 'Informe suas duas cartas manualmente para liberar a decisão.';
  if (heroReady && !publicBoard.trusted) reason = publicBoard.reason;
  else if (heroReady && rawStableFrames < 2) reason = 'Aguardando a segunda leitura rápida igual (2/2).';

  return {
    trusted,
    heroReady,
    reason,
    age,
    freshnessWindow,
    confidence: Number(d?.confidence) || 0,
    latency,
    actions: actions.length,
    stableFrames,
    rawStableFrames,
    publicBoard,
    aggressorName: d?.aggressorName || null,
    aggressorCommitted: Number.isFinite(d?.aggressorCommitted) ? d.aggressorCommitted : null,
    heroCommitted: Number.isFinite(d?.heroCommitted) ? d.heroCommitted : null,
    error: d?.lastError || null,
  };
}

function unopenedPreflopOwnedByPolicy(entry, fast) {
  const machine = activeHandMachine;
  if (!entry || entry.source === 'preflop-unopened-policy-r14') return false;
  if (!machine || machine.state?.street !== 'preflop') return false;
  const table = activeTableStateTracker?.latest;
  if (!table || Number(table.handId) !== Number(machine.handId) || !Array.isArray(table.seats)) return false;
  const context = classifyPreflopContext({
    seats: table.seats,
    heroCommitted: fast.heroCommitted,
    proposedAggressorName: fast.aggressorName,
    proposedAggressorCommitted: fast.aggressorCommitted,
  });
  return context.mode === 'unopened';
}

setDecisionGate((entry) => {
  if (!entry || !STRATEGIC.has(entry.decision)) return entry;

  const fast = decisionTrust();
  if (!fast.trusted) {
    const reason = !fast.heroReady
      ? 'Informe suas duas cartas manualmente para liberar a decisão.'
      : fast.error
        ? `IA rápida indisponível: ${fast.error}`
        : fast.reason || 'A decisão atual ainda não fechou duas leituras iguais.';
    const age = Number.isFinite(fast.age) ? `${Math.round(fast.age)}ms atrás` : 'sem leitura rápida válida';
    const board = fast.publicBoard || {};

    return {
      ...entry,
      decision: 'LEITURA INSUFICIENTE',
      reason,
      details: `Segurança de estudo · Hero manual ${fast.heroReady ? 'OK' : 'pendente'} · IA rápida ${fast.rawStableFrames}/2 (consenso ${fast.stableFrames}/2) · board físico ${Number.isFinite(board.physicalCount) ? board.physicalCount : '?'} / estado ${Number.isFinite(board.logicalCount) ? board.logicalCount : '?'} · confiança ${Math.round(fast.confidence * 100)}% · ${fast.actions} ações atuais · ${fast.aggressorName ? `agressor ${fast.aggressorName}` : 'sem agressor confirmado'} · ${age}.`,
      confidence: 0,
      source: 'study-safety-gate-ai-r14',
    };
  }

  if (unopenedPreflopOwnedByPolicy(entry, fast)) {
    return {
      ...entry,
      decision: 'LEITURA INSUFICIENTE',
      reason: 'Pote pré-flop unopened confirmado; classificando posição e faixa de open antes de cravar a ação.',
      details: 'Blinds obrigatórios não contam como agressão. Esta decisão será publicada somente pela política pré-flop de posição.',
      confidence: 0,
      source: 'study-safety-gate-preflop-policy-r14',
    };
  }

  return entry;
});

if (typeof window !== 'undefined') {
  window.__prcStudySafetyGateR14 = {
    enabled: true,
    requires: ['manual-hero','ai-decision-raw-2of2','physical-board-match'],
    stableDecisionFrames: 2,
    rawDecisionFrames: 2,
    physicalBoardConsensus: 3,
    unopenedPreflopPolicy: true,
    finalDecisionFrozenUntilHeroActs: true,
  };
}
