import { activeHandMachine } from '../core/state-machine.js';

const d = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;

const diagnostics = {
  enabled: true,
  handId: 0,
  processedResponses: 0,
  boardHits: 0,
  potHits: 0,
  actionsHits: 0,
  aggressorHits: 0,
  prepared: false,
  potCommits: 0,
  postApplyReasserts: 0,
  lastReason: 'boot',
};

let lastProcessedResponses = 0;
let handId = 0;
let boardCandidate = null;
let potCandidate = null;
let actionsCandidate = null;
let aggressorCandidate = null;
let confirmedBoard = null;
let confirmedPot = null;
let confirmedActions = null;
let confirmedAggressorName = null;
let confirmedAggressorCommitted = null;
let confirmedHeroCommitted = null;
let actionsBacking = Array.isArray(d?.actions) ? d.actions : [];
let writingConfirmedActions = false;

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function cardId(card) {
  return card?.rank && card?.suit ? `${String(card.rank).toUpperCase()}:${String(card.suit)}` : '?';
}

function boardKey(cards) {
  if (!Array.isArray(cards) || ![0, 3, 4, 5].includes(cards.length)) return '';
  if (!cards.length) return 'empty';
  const key = cards.map(cardId).join(',');
  return key.includes('?') ? '' : key;
}

function actionKey(actions) {
  return (actions || [])
    .map((action) => `${String(action?.type || '-')}:${Number.isFinite(action?.amount) ? Math.round(action.amount * 1000) / 1000 : '-'}`)
    .sort()
    .join('|');
}

function closePot(a, b) {
  return Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.03);
}

function reset(reason = 'reset') {
  handId = Number(activeHandMachine?.handId) || 0;
  lastProcessedResponses = Number(d?.responses) || 0;
  boardCandidate = null;
  potCandidate = null;
  actionsCandidate = null;
  aggressorCandidate = null;
  confirmedBoard = null;
  confirmedPot = null;
  confirmedActions = null;
  confirmedAggressorName = null;
  confirmedAggressorCommitted = null;
  confirmedHeroCommitted = null;
  diagnostics.handId = handId;
  diagnostics.processedResponses = lastProcessedResponses;
  diagnostics.boardHits = 0;
  diagnostics.potHits = 0;
  diagnostics.actionsHits = 0;
  diagnostics.aggressorHits = 0;
  diagnostics.prepared = false;
  diagnostics.lastReason = reason;
  if (d) {
    d.publicFieldConsensus = { board: 0, pot: 0, actions: 0, aggressor: 0 };
  }
}

function observeBoard() {
  const key = boardKey(d?.board);
  const confidence = Number(d?.boardConfidence) || 0;
  if (!key || confidence < (key === 'empty' ? 0.68 : 0.78)) {
    boardCandidate = null;
    diagnostics.boardHits = 0;
    return;
  }

  if (boardCandidate?.key === key) {
    boardCandidate.hits++;
    boardCandidate.cards = (d.board || []).map((card) => ({ ...card }));
  } else {
    boardCandidate = { key, hits: 1, cards: (d.board || []).map((card) => ({ ...card })) };
  }
  diagnostics.boardHits = Math.min(2, boardCandidate.hits);
  if (boardCandidate.hits >= 2) confirmedBoard = boardCandidate.cards.map((card) => ({ ...card }));
}

function observePot() {
  const value = Number(d?.pot);
  const confidence = Number(d?.potConfidence) || 0;
  if (!Number.isFinite(value) || value <= 0 || confidence < 0.84) {
    potCandidate = null;
    diagnostics.potHits = 0;
    return;
  }

  if (potCandidate && closePot(potCandidate.value, value)) {
    potCandidate.hits++;
    potCandidate.value = value;
  } else {
    potCandidate = { value, hits: 1 };
  }
  diagnostics.potHits = Math.min(2, potCandidate.hits);
  if (potCandidate.hits >= 2) confirmedPot = potCandidate.value;
}

function observeActions() {
  const actions = Array.isArray(actionsBacking) ? actionsBacking : [];
  const confidence = Number(d?.actionsConfidence) || 0;
  const call = actions.find((action) => action?.type === 'call');
  const pricedCall = !call || Number.isFinite(call.amount);
  const key = actionKey(actions);
  const heroTurn = d?.heroToAct === true || actions.length >= 2;

  if (!heroTurn || actions.length < 2 || !pricedCall || confidence < 0.78 || !key) {
    actionsCandidate = null;
    diagnostics.actionsHits = 0;
    return;
  }

  if (actionsCandidate?.key === key) {
    actionsCandidate.hits++;
    actionsCandidate.actions = actions.map((action) => ({ ...action }));
  } else {
    actionsCandidate = { key, hits: 1, actions: actions.map((action) => ({ ...action })) };
  }
  diagnostics.actionsHits = Math.min(2, actionsCandidate.hits);
  if (actionsCandidate.hits >= 2) confirmedActions = actionsCandidate.actions.map((action) => ({ ...action }));
}

function observeAggressor() {
  const name = String(d?.aggressorName || '').trim();
  const committed = Number.isFinite(d?.aggressorCommitted) ? Number(d.aggressorCommitted) : null;
  const heroCommitted = Number.isFinite(d?.heroCommitted) ? Number(d.heroCommitted) : null;
  const confidence = Number(d?.aggressorConfidence) || 0;
  const key = name
    ? `${name.toLowerCase()}#${Number.isFinite(committed) ? Math.round(committed * 1000) / 1000 : '-'}`
    : 'none';

  if (name && confidence < 0.68) {
    aggressorCandidate = null;
    diagnostics.aggressorHits = 0;
    return;
  }

  if (aggressorCandidate?.key === key) {
    aggressorCandidate.hits++;
    aggressorCandidate.name = name || null;
    aggressorCandidate.committed = committed;
    aggressorCandidate.heroCommitted = heroCommitted;
  } else {
    aggressorCandidate = { key, hits: 1, name: name || null, committed, heroCommitted };
  }
  diagnostics.aggressorHits = Math.min(2, aggressorCandidate.hits);

  if (aggressorCandidate.hits >= 2) {
    confirmedAggressorName = aggressorCandidate.name;
    confirmedAggressorCommitted = aggressorCandidate.committed;
    confirmedHeroCommitted = aggressorCandidate.heroCommitted;
  }
}

function commitConfirmedPot() {
  const machine = activeHandMachine;
  if (!machine || Number(machine.handId) !== handId) return;
  if (!Number.isFinite(confirmedPot) || diagnostics.potHits < 2) return;

  const currentPot = Number(machine.state?.pot);
  if (closePot(currentPot, confirmedPot)) return;
  if (machine.setPot(confirmedPot, machine.handId, {
    source: 'ai-decision',
    now: now(),
  })) diagnostics.potCommits++;
}

function publishConsensus() {
  if (!d) return;
  const boardReady = diagnostics.boardHits >= 2 && confirmedBoard !== null;
  const potReady = diagnostics.potHits >= 2 && Number.isFinite(confirmedPot);
  const actionsReady = diagnostics.actionsHits >= 2 && Array.isArray(confirmedActions) && confirmedActions.length >= 2;
  const ready = boardReady && potReady && actionsReady;

  d.publicFieldConsensus = {
    board: diagnostics.boardHits,
    pot: diagnostics.potHits,
    actions: diagnostics.actionsHits,
    aggressor: diagnostics.aggressorHits,
  };

  if (confirmedBoard !== null) d.board = confirmedBoard.map((card) => ({ ...card }));
  if (Number.isFinite(confirmedPot)) d.pot = confirmedPot;
  if (confirmedActions) {
    writingConfirmedActions = true;
    try {
      d.actions = confirmedActions.map((action) => ({ ...action }));
    } finally {
      writingConfirmedActions = false;
    }
  }
  if (diagnostics.aggressorHits >= 2) {
    d.aggressorName = confirmedAggressorName;
    d.aggressorCommitted = confirmedAggressorCommitted;
    d.heroCommitted = confirmedHeroCommitted;
  }

  if (ready) {
    d.rawStableFrames = Math.max(2, Number(d.rawStableFrames) || 0);
    d.stableDecisionFrames = Math.max(2, Number(d.stableDecisionFrames) || 0);
    d.publicPrepared = true;
    if (!d.publicPreparedAt) d.publicPreparedAt = d.lastSeenAt || now();
    diagnostics.prepared = true;
    diagnostics.lastReason = 'public-fields-2of2';
  } else {
    diagnostics.prepared = false;
    diagnostics.lastReason = `board-${diagnostics.boardHits}/2 pot-${diagnostics.potHits}/2 actions-${diagnostics.actionsHits}/2`;
  }
}

function processAppliedResponse() {
  if (!d || !activeHandMachine || activeHandMachine.handId <= 0) return false;
  const currentHand = Number(activeHandMachine.handId);
  if (currentHand !== handId) reset('hand-change');

  const responses = Number(d.responses) || 0;
  if (responses <= lastProcessedResponses) return false;
  lastProcessedResponses = responses;
  diagnostics.processedResponses = responses;

  observeBoard();
  observePot();
  observeActions();
  observeAggressor();
  commitConfirmedPot();
  publishConsensus();
  return true;
}

function schedulePostApplyConsensus() {
  const reassert = () => {
    if (!d || Number(activeHandMachine?.handId) !== handId) return;
    commitConfirmedPot();
    publishConsensus();
    if (diagnostics.prepared) diagnostics.postApplyReasserts++;
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(reassert);
  else Promise.resolve().then(reassert);
}

function installResponseHook() {
  if (!d || d.__prcFieldConsensusActionsHook) return;
  const initial = Array.isArray(d.actions) ? d.actions : [];
  actionsBacking = initial;
  Object.defineProperty(d, 'actions', {
    configurable: true,
    enumerable: true,
    get() {
      return actionsBacking;
    },
    set(value) {
      actionsBacking = Array.isArray(value) ? value : [];
      if (!writingConfirmedActions && processAppliedResponse()) schedulePostApplyConsensus();
    },
  });
  d.__prcFieldConsensusActionsHook = true;
}

if (typeof window !== 'undefined' && d) {
  window.__prcAIDecisionFieldConsensusR14 = diagnostics;
  installResponseHook();
  reset('boot');
  window.addEventListener('prc:generation-change', () => reset('generation-change'));
}
