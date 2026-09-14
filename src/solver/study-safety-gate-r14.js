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

function publicBoardTrust(d = null) {
  const machine = activeHandMachine;
  const publicLifecycle = typeof window !== 'undefined' ? window.__prcPublicLifecycleR14 : null;
  const life = typeof publicLifecycle?.view === 'function' ? publicLifecycle.view() : publicLifecycle;
  const t = nowMs();
  if (!machine) return { trusted: false, reason: 'O estado atual da mão ainda não iniciou.' };

  const logicalBoard = Array.isArray(machine.state?.board) ? machine.state.board : [];
  const logicalCount = logicalBoard.length;
  const logicalStreet = String(machine.state?.street || 'preflop');
  const expectedStreet = streetForBoardCount(logicalCount);
  const streetMatches = logicalStreet === expectedStreet;

  const age = life && Number.isFinite(Number(life.visualBoardUpdatedAt)) ? t - Number(life.visualBoardUpdatedAt) : Infinity;
  const physicalCount = life ? Number(life.visualBoardCount) : NaN;
  const physicalHits = life ? Number(life.visualBoardHits) || 0 : 0;
  const stablePhysical = Boolean(life) && [0,3,4,5].includes(physicalCount) && physicalHits >= 3 && age <= 1400;
  const transitioning = Boolean(life?.heroGapArmed || life?.boardClearArmed);
  const countMatches = stablePhysical && physicalCount === logicalCount;

  const fastBoard = Array.isArray(d?.board) ? d.board : [];
  const fastIdentityConsensus = Number(d?.rawStableFrames) >= 2
    && [0,3,4,5].includes(fastBoard.length)
    && exactCards(logicalBoard, fastBoard)
    && streetForBoardCount(fastBoard.length) === logicalStreet;

  const trusted = !transitioning
    && streetMatches
    && ((stablePhysical && countMatches) || fastIdentityConsensus);

  let reason = trusted
    ? (fastIdentityConsensus && !(stablePhysical && countMatches)
        ? 'Board confirmado por identidade exata na IA rápida 2/2.'
        : 'Board físico sincronizado.')
    : 'Aguardando confirmação do board atual.';
  if (transitioning) reason = 'Troca de mão detectada; invalidando o estado anterior.';
  else if (!streetMatches) reason = `Street ${logicalStreet} não corresponde ao board atual.`;
  else if (stablePhysical && !countMatches) reason = `Board físico tem ${physicalCount} cartas, mas o estado ainda tem ${logicalCount}.`;
  else if (!stablePhysical && !fastIdentityConsensus) reason = 'Aguardando board físico ou identidade exata 2/2 da IA rápida.';

  return {
    trusted,
    reason,
    age,
    physicalCount,
    physicalHits,
    logicalCount,
    transitioning,
    fastIdentityConsensus,
  };
}

function tableContextTrust(d = null) {
  const machine = activeHandMachine;
  const table = activeTableStateTracker?.latest;
  const t = nowMs();
  if (!machine || !table || Number(table.handId) !== Number(machine.handId)) {
    return { trusted: false, reason: 'Aguardando a leitura atual dos assentos, posições e apostas.' };
  }

  const age = Number.isFinite(Number(table.observedAt)) ? t - Number(table.observedAt) : Infinity;
  const seats = Array.isArray(table.seats) ? table.seats : [];
  const heroSeat = seats.find((seat) => seat?.hero);
  const fresh = age <= 8500;
  const enoughSeats = seats.filter((seat) => seat && (seat.hero || seat.actorName || Number.isFinite(seat.stack) || Number.isFinite(seat.committed))).length >= 2;
  const heroKnown = Boolean(heroSeat);
  const preflop = machine.state?.street === 'preflop';
  const positionKnown = !preflop || Boolean(table.heroPosition || heroSeat?.position);

  let preflopContext = null;
  if (preflop && fresh && enoughSeats && heroKnown && positionKnown) {
    preflopContext = classifyPreflopContext({
      seats,
      heroCommitted: Number.isFinite(d?.heroCommitted) ? d.heroCommitted : heroSeat?.committed,
      proposedAggressorName: d?.aggressorName,
      proposedAggressorCommitted: d?.aggressorCommitted,
    });
  }

  const contextKnown = !preflop || ['unopened','limped','raised'].includes(preflopContext?.mode);
  const trusted = Boolean(fresh && enoughSeats && heroKnown && positionKnown && contextKnown);

  let reason = 'Mesa, posições e apostas atuais confirmadas.';
  if (!fresh) reason = 'A leitura dos jogadores/posições está velha; aguardando um frame inteiro atual.';
  else if (!enoughSeats) reason = 'Ainda não há assentos suficientes confirmados para reconstruir a ação.';
  else if (!heroKnown) reason = 'A posição do Hero ainda não foi ligada a um assento da mesa.';
  else if (!positionKnown) reason = 'A posição pré-flop do Hero ainda não foi confirmada.';
  else if (!contextKnown) reason = 'Ainda não foi possível reconstruir se o pote está unopened, limpado ou aumentado.';

  return {
    trusted,
    reason,
    age,
    seatCount: seats.length,
    heroPosition: table.heroPosition || heroSeat?.position || null,
    preflopMode: preflopContext?.mode || null,
  };
}

function decisionTrust() {
  const d = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;
  const continuity = typeof window !== 'undefined' ? window.__prcHeroContinuityGuardR14 : null;
  const boundaryPending = Boolean(continuity?.preflopBoundaryPending);
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
  const publicBoard = publicBoardTrust(d);
  const tableContext = tableContextTrust(d);
  const trusted = Boolean(d?.trusted)
    && heroReady
    && !boundaryPending
    && rawStableFrames >= 2
    && stableFrames >= 2
    && sameHand
    && coreMatches
    && publicBoard.trusted
    && tableContext.trusted
    && age <= freshnessWindow
    && actions.length >= 2
    && hasPricedCall;

  let reason = heroReady ? (d?.trustReason || 'A IA rápida ainda não confirmou a decisão atual.') : 'Informe suas duas cartas manualmente para liberar a decisão.';
  if (heroReady && boundaryPending) reason = 'Confirmando publicamente se começou uma nova mão; preservando suas cartas até dealer/pote provarem o redeal.';
  else if (heroReady && !publicBoard.trusted) reason = publicBoard.reason;
  else if (heroReady && !tableContext.trusted) reason = tableContext.reason;
  else if (heroReady && rawStableFrames < 2) reason = 'Aguardando a segunda leitura rápida igual (2/2).';

  return {
    trusted,
    heroReady,
    boundaryPending,
    reason,
    age,
    freshnessWindow,
    confidence: Number(d?.confidence) || 0,
    latency,
    actions: actions.length,
    stableFrames,
    rawStableFrames,
    publicBoard,
    tableContext,
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
    const table = fast.tableContext || {};

    return {
      ...entry,
      decision: 'LEITURA INSUFICIENTE',
      reason,
      details: `Segurança de estudo · Hero manual ${fast.heroReady ? 'OK' : 'pendente'} · IA rápida ${fast.rawStableFrames}/2 (consenso ${fast.stableFrames}/2)${fast.boundaryPending ? ' · redeal público pendente' : ''} · board físico ${Number.isFinite(board.physicalCount) ? board.physicalCount : '?'} / estado ${Number.isFinite(board.logicalCount) ? board.logicalCount : '?'}${board.fastIdentityConsensus ? ' · identidade rápida OK' : ''} · mesa ${table.heroPosition || '?'} / ${table.preflopMode || machine?.state?.street || '?'} · confiança ${Math.round(fast.confidence * 100)}% · ${fast.actions} ações atuais · ${fast.aggressorName ? `agressor ${fast.aggressorName}` : 'sem agressor confirmado'} · ${age}.`,
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
    requires: ['manual-hero','public-redeal-evidence','ai-decision-raw-2of2','physical-board-or-fast-identity','fresh-table-context'],
    stableDecisionFrames: 2,
    rawDecisionFrames: 2,
    physicalBoardConsensus: 3,
    fastBoardIdentityConsensus: 2,
    tableContextMaxAgeMs: 8500,
    unopenedPreflopPolicy: true,
    finalDecisionFrozenUntilHeroActs: true,
  };
}
