import { cardId } from '../solver/hand-evaluator.js';
import { activeHandMachine } from './state-machine.js';

let current = null;
let decisionGate = null;
let lockedFinal = null;
let turnStartedAt = 0;
let deadlineReached = false;
let lastPositiveTurnAt = 0;
let pendingEpochMismatchKey = '';
let pendingEpochMismatchAt = 0;

const STRATEGIC = new Set(['PAGAR','DESISTIR','PASSAR','APOSTAR','AUMENTAR','ALL-IN']);
const HARD_DEADLINE_MS = 7000;
const WATCHDOG_MS = 100;
const TURN_END_GRACE_MS = 900;
const ACTION_EPOCH_CONFIRM_MS = 320;
const ACTION_ORDER = Object.freeze(['fold','check','call','bet','raise','allin']);

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function dispatchCurrent() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('prc:decision', { detail: current }));
}

function uiHeroTurn() {
  if (typeof document === 'undefined') return false;
  return String(document.getElementById('turnChip')?.textContent || '').toUpperCase().includes('SUA VEZ');
}

function fastTurnSignal() {
  if (typeof window === 'undefined') return false;
  const d = window.__prcAIDecisionR14;
  const machine = activeHandMachine;
  if (!d || !machine || machine.handId <= 0 || Number(d.handId) !== Number(machine.handId)) return false;

  const lifecycle = String(d.trustReason || '').startsWith('Sua vez');
  const age = Number.isFinite(Number(d.lastSeenAt)) && Number(d.lastSeenAt) > 0
    ? nowMs() - Number(d.lastSeenAt)
    : Infinity;
  const latency = Math.max(0, Number(d.lastLatencyMs) || 0);
  const freshnessWindow = Math.max(4500, Math.min(9000, latency * 2 + 1800));
  const actions = Array.isArray(d.actions) ? d.actions : [];
  const freshDecisionFrame = d.heroToAct === true && actions.length >= 2 && age <= freshnessWindow;

  return lifecycle || freshDecisionFrame;
}

function rawHeroTurnSignal() {
  return Boolean(activeHandMachine?.state?.heroToAct || uiHeroTurn() || fastTurnSignal());
}

function heroTurnActive() {
  const now = nowMs();
  if (rawHeroTurnSignal()) {
    lastPositiveTurnAt = now;
    return true;
  }
  return Boolean((turnStartedAt || lockedFinal) && lastPositiveTurnAt > 0 && now - lastPositiveTurnAt <= TURN_END_GRACE_MS);
}

// Historical function name retained for test/backwards compatibility. Hero can
// now be confirmed manually OR by the local replay reader. The clock does not
// care which source won; it starts only after the two complete cards are locked
// to the current generation.
function manualHeroReadyForDecision() {
  const machine = activeHandMachine;
  const authority = typeof window !== 'undefined' ? window.__prcManualHeroAuthorityR14 : null;
  const hero = machine?.state?.hero || [];
  return Boolean(
    machine?.handId > 0
    && authority?.heroLocked
    && Number(authority.handId) === Number(machine.handId)
    && hero.length === 2
    && hero.every((card) => card?.rank && card?.suit)
  );
}

function heroSourceLabel() {
  if (typeof window === 'undefined') return 'confirmado';
  const source = window.__prcManualHeroAuthorityR14?.heroSource;
  return source === 'replay-auto' ? 'automático local' : source === 'manual' ? 'manual' : 'confirmado';
}

function resetTurnLock() {
  lockedFinal = null;
  turnStartedAt = 0;
  deadlineReached = false;
  lastPositiveTurnAt = 0;
  pendingEpochMismatchKey = '';
  pendingEpochMismatchAt = 0;
}

function normalizedAmount(value) {
  if (!Number.isFinite(value)) return '-';
  const number = Number(value);
  if (Math.abs(number) < 10) return String(Math.round(number * 100) / 100);
  return String(Math.round(number * 1000) / 1000);
}

function normalizeDecisionActions(actions = []) {
  const rows = (actions || [])
    .map((action) => ({
      type: String(action?.type || '').toLowerCase(),
      amount: Number.isFinite(action?.amount) ? Number(action.amount) : null,
    }))
    .filter((action) => ACTION_ORDER.includes(action.type));

  const types = new Set(rows.map((action) => action.type));
  const hasCheck = types.has('check');
  const hasCall = types.has('call');
  const normalized = new Map();

  for (const action of rows) {
    let type = action.type;
    if (['bet','raise'].includes(type)) {
      if (hasCheck && !hasCall) type = 'bet';
      else if (hasCall) type = 'raise';
    }
    const existing = normalized.get(type);
    if (!existing || (!Number.isFinite(existing.amount) && Number.isFinite(action.amount))) {
      normalized.set(type, { type, amount: action.amount });
    }
  }

  return ACTION_ORDER
    .filter((type) => normalized.has(type))
    .map((type) => normalized.get(type));
}

function actionKey(actions = []) {
  return normalizeDecisionActions(actions)
    .map((action) => `${action.type}:${normalizedAmount(action.amount)}`)
    .join('|');
}

function identityKey(handId, state = {}) {
  const hero = (state.hero || []).map(cardId).join(',');
  const board = (state.board || []).map(cardId).join(',');
  return `${handId || 0}#${state.street || '-'}#${hero}#${board}`;
}

export function decisionStateKey(handId, state = {}) {
  const base = identityKey(handId, state);
  const pot = Number.isFinite(state.pot) ? normalizedAmount(Number(state.pot)) : '-';
  return `${base}#${pot}#${actionKey(state.actions || [])}`;
}

export function decisionEpochKey(handId, state = {}) {
  return `${identityKey(handId, state)}#${actionKey(state.actions || [])}`;
}

function currentStateKey() {
  const machine = activeHandMachine;
  return machine ? decisionStateKey(machine.handId, machine.state) : '0#-';
}

function currentEpochKey() {
  const machine = activeHandMachine;
  return machine ? decisionEpochKey(machine.handId, machine.state) : '0#-';
}

function currentIdentityKey() {
  const machine = activeHandMachine;
  return machine ? identityKey(machine.handId, machine.state) : '0#-';
}

function invalidateStaleLock() {
  if (!lockedFinal) return false;

  // A real hand/street/board/Hero transition invalidates immediately.
  const liveIdentity = currentIdentityKey();
  if (lockedFinal.identityKey !== liveIdentity) {
    lockedFinal = null;
    current = null;
    deadlineReached = false;
    pendingEpochMismatchKey = '';
    pendingEpochMismatchAt = 0;
    turnStartedAt = heroTurnActive() && manualHeroReadyForDecision() ? nowMs() : 0;
    return true;
  }

  const liveEpoch = currentEpochKey();
  if (lockedFinal.epochKey === liveEpoch) {
    pendingEpochMismatchKey = '';
    pendingEpochMismatchAt = 0;
    return false;
  }

  // Action OCR/button semantics can flicker for one or two frames. Do not pull a
  // valid study recommendation off screen unless the new action epoch persists.
  const now = nowMs();
  if (pendingEpochMismatchKey !== liveEpoch) {
    pendingEpochMismatchKey = liveEpoch;
    pendingEpochMismatchAt = now;
    return false;
  }
  if (now - pendingEpochMismatchAt < ACTION_EPOCH_CONFIRM_MS) return false;

  lockedFinal = null;
  current = null;
  deadlineReached = false;
  pendingEpochMismatchKey = '';
  pendingEpochMismatchAt = 0;
  turnStartedAt = heroTurnActive() && manualHeroReadyForDecision() ? now : 0;
  return true;
}

function ensureTurnClock() {
  const active = heroTurnActive();
  const heroReady = manualHeroReadyForDecision();
  if (active && heroReady && !turnStartedAt) {
    turnStartedAt = nowMs();
    deadlineReached = false;
  }
  if (!active && (turnStartedAt || lockedFinal || deadlineReached)) resetTurnLock();
  return active;
}

function analyzingEntry(elapsed = 0, reason = 'Fechando o snapshot desta decisão.') {
  const heroReady = manualHeroReadyForDecision();
  let suffix;
  if (!heroReady) {
    suffix = ' O relógio estratégico ainda NÃO começou; ele só inicia depois que as duas cartas do Hero forem confirmadas.';
  } else if (elapsed < HARD_DEADLINE_MS) {
    suffix = ` Hero ${heroSourceLabel()} confirmado; fechando a leitura atual (${Math.round(elapsed)}ms).`;
  } else {
    suffix = ` Hero ${heroSourceLabel()} confirmado; a leitura passou de ${Math.round(HARD_DEADLINE_MS / 1000)}s, mas atraso sozinho NÃO vira LEITURA INSUFICIENTE. Continuo tentando enquanto este spot for atual.`;
  }
  return {
    stateKey: currentStateKey(),
    decision: 'ANALISANDO',
    reason: `${reason}${suffix}`,
    details: 'Núcleo atual: Hero confirmado, board, pote, stacks, jogadores ativos, posição/dealer e ação atual. Histórico completo apenas refina range/confiança.',
    confidence: 0,
    source: 'r14-decision-finalizer',
  };
}

export function setDecisionGate(gate) {
  decisionGate = typeof gate === 'function' ? gate : null;
}

export function publishDecision(entry) {
  const activeTurn = ensureTurnClock();
  invalidateStaleLock();

  if (activeTurn && lockedFinal) {
    current = { ...lockedFinal };
    dispatchCurrent();
    return current;
  }

  let next = entry ? { ...entry } : null;
  if (next && decisionGate) {
    try {
      const gated = decisionGate(next);
      if (gated === null) next = null;
      else if (gated && typeof gated === 'object') next = { ...gated };
    } catch {
      next = {
        ...next,
        decision: 'LEITURA INSUFICIENTE',
        reason: 'A trava do núcleo atual não pôde validar esta decisão.',
        details: 'Nenhuma recomendação estratégica é liberada sem Hero, board, pote, stacks/jogadores e ação atual coerentes.',
        confidence: 0,
        source: 'decision-core-gate-r14',
      };
    }
  }

  if (activeTurn && next) {
    const elapsed = turnStartedAt ? nowMs() - turnStartedAt : 0;
    if (STRATEGIC.has(next.decision)) {
      lockedFinal = {
        ...next,
        finalDecision: true,
        lockedAt: nowMs(),
        turnStartedAt: turnStartedAt || nowMs(),
        epochKey: currentEpochKey(),
        identityKey: currentIdentityKey(),
      };
      pendingEpochMismatchKey = '';
      pendingEpochMismatchAt = 0;
      next = { ...lockedFinal };
    } else if (next.decision === 'LEITURA INSUFICIENTE') {
      // In replay study, elapsed time is not evidence that the poker state is
      // unreadable. Keep ANALISANDO and let a later trustworthy snapshot win.
      deadlineReached = elapsed >= HARD_DEADLINE_MS;
      next = analyzingEntry(elapsed, next.reason || 'Ainda estou fechando o núcleo atual.');
    }
  }

  current = next;
  dispatchCurrent();
  return current;
}

export function clearDecision() {
  const activeTurn = ensureTurnClock();
  invalidateStaleLock();
  if (activeTurn) {
    if (lockedFinal) {
      current = { ...lockedFinal };
    } else {
      const elapsed = turnStartedAt ? nowMs() - turnStartedAt : 0;
      deadlineReached = manualHeroReadyForDecision() && elapsed >= HARD_DEADLINE_MS;
      current = analyzingEntry(elapsed, manualHeroReadyForDecision() ? 'Ainda estou fechando a ação atual.' : 'Aguardando confirmação das suas duas cartas.');
    }
    dispatchCurrent();
    return current;
  }

  current = null;
  resetTurnLock();
  dispatchCurrent();
  return null;
}

export function getDecision(stateKey = null) {
  invalidateStaleLock();
  if (!current) return null;
  if (lockedFinal && heroTurnActive()) return current;
  if (stateKey && current.stateKey !== stateKey) return null;
  return current;
}

function decisionWatchdog() {
  const activeTurn = ensureTurnClock();
  invalidateStaleLock();

  if (!activeTurn) {
    if (current) {
      current = null;
      dispatchCurrent();
    }
    return;
  }

  if (lockedFinal) return;
  if (!manualHeroReadyForDecision()) {
    if (!current || current.decision !== 'ANALISANDO') {
      current = analyzingEntry(0, 'Aguardando confirmação das suas duas cartas.');
      dispatchCurrent();
    }
    return;
  }

  const elapsed = turnStartedAt ? nowMs() - turnStartedAt : 0;
  const crossedDeadline = elapsed >= HARD_DEADLINE_MS;
  if (crossedDeadline && !deadlineReached) {
    deadlineReached = true;
    current = analyzingEntry(elapsed, 'A leitura está levando mais tempo, mas o spot continua atual.');
    dispatchCurrent();
    return;
  }

  if (!current || current.decision === 'LEITURA INSUFICIENTE') {
    current = analyzingEntry(elapsed, 'Ainda estou fechando a ação atual.');
    dispatchCurrent();
  }
}

if (typeof window !== 'undefined') {
  window.__prcDecisionFinalizerR14 = {
    deadlineMs: HARD_DEADLINE_MS,
    watchdogMs: WATCHDOG_MS,
    turnEndGraceMs: TURN_END_GRACE_MS,
    actionEpochConfirmMs: ACTION_EPOCH_CONFIRM_MS,
    fastTurnFallback: true,
    strategicDeadlineFallback: false,
    timeoutDoesNotForceInsufficient: true,
    // Legacy flag retained for compatibility; semantic replacement below.
    clockStartsAfterManualHero: true,
    clockStartsAfterHeroConfirmation: true,
    lockFollowsDecisionEpoch: true,
    semanticActionEpoch: true,
    get heroSource() { return window.__prcManualHeroAuthorityR14?.heroSource || null; },
    get locked() { return lockedFinal ? { ...lockedFinal } : null; },
    get deadlineReached() { return deadlineReached; },
    get elapsedMs() { return turnStartedAt ? nowMs() - turnStartedAt : 0; },
  };
  setInterval(decisionWatchdog, WATCHDOG_MS);
}
