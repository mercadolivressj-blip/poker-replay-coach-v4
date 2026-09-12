import { cardId } from '../solver/hand-evaluator.js';
import { activeHandMachine } from './state-machine.js';

let current = null;
let decisionGate = null;
let lockedFinal = null;
let turnStartedAt = 0;

const STRATEGIC = new Set(['PAGAR','DESISTIR','PASSAR','APOSTAR','AUMENTAR','ALL-IN']);
const HARD_DEADLINE_MS = 7000;
const WATCHDOG_MS = 100;

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

  // startTurn() in the fast-vision runtime writes this lifecycle message before
  // the first API response arrives. This lets the 7s clock begin even when the
  // local action-button detector misses the turn completely.
  const lifecycle = String(d.trustReason || '').startsWith('Sua vez');

  // After the first response, keep the signal alive only while the decision
  // frame itself is fresh and still contains current Hero actions. endTurn()
  // clears actions, which prevents a stale heroToAct=true from extending a turn.
  const age = Number.isFinite(Number(d.lastSeenAt)) && Number(d.lastSeenAt) > 0
    ? nowMs() - Number(d.lastSeenAt)
    : Infinity;
  const latency = Math.max(0, Number(d.lastLatencyMs) || 0);
  const freshnessWindow = Math.max(4500, Math.min(9000, latency * 2 + 1800));
  const actions = Array.isArray(d.actions) ? d.actions : [];
  const freshDecisionFrame = d.heroToAct === true && actions.length >= 2 && age <= freshnessWindow;

  return lifecycle || freshDecisionFrame;
}

function heroTurnActive() {
  return Boolean(activeHandMachine?.state?.heroToAct || uiHeroTurn() || fastTurnSignal());
}

function resetTurnLock() {
  lockedFinal = null;
  turnStartedAt = 0;
}

function ensureTurnClock() {
  const active = heroTurnActive();
  if (active && !turnStartedAt) turnStartedAt = nowMs();
  if (!active && turnStartedAt) resetTurnLock();
  return active;
}

function availableActionTypes() {
  const types = new Set((activeHandMachine?.state?.actions || []).map((a) => a?.type).filter(Boolean));
  const fast = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;
  for (const action of fast?.actions || []) if (action?.type) types.add(action.type);
  return types;
}

function currentStateKey() {
  const machine = activeHandMachine;
  return machine ? decisionStateKey(machine.handId, machine.state) : '0#-';
}

function analyzingEntry(elapsed = 0, reason = 'Fechando o snapshot desta decisão.') {
  return {
    stateKey: currentStateKey(),
    decision: 'ANALISANDO',
    reason: `${reason} Vou publicar uma ação final em até ${Math.max(0, Math.ceil((HARD_DEADLINE_MS - elapsed) / 1000))}s.`,
    details: 'Cartas, board, pote, ações e contexto da mesa estão sendo confirmados antes de congelar a recomendação.',
    confidence: 0,
    source: 'r14-decision-finalizer',
  };
}

function conservativeDeadlineDecision(entry, elapsed) {
  const types = availableActionTypes();
  // If the snapshot still has not closed by the hard deadline, never invent an
  // investment. In an unopened/checkable spot, CHECK is the conservative legal
  // action. When facing a wager (or when actions remain unreadable), FOLD is the
  // fail-closed answer. This guarantees the 10-second study window ends with one
  // actionable answer without teaching a speculative call/raise from incomplete evidence.
  const noWagerSpot = types.has('check') || (types.has('bet') && !types.has('call'));
  const decision = noWagerSpot ? 'PASSAR' : 'DESISTIR';

  return {
    ...(entry || {}),
    stateKey: entry?.stateKey || currentStateKey(),
    decision,
    reason: decision === 'PASSAR'
      ? 'Prazo de decisão atingido sem snapshot completo; linha conservadora: PASSAR sem investir fichas.'
      : 'Prazo de decisão atingido sem snapshot completo; linha conservadora: DESISTIR em vez de investir com informação incompleta.',
    details: `DECISÃO FINAL POR PRAZO · ${Math.round(elapsed)}ms · o Coach não muda esta ação até o Hero agir.`,
    confidence: 25,
    source: 'r14-decision-deadline-finalizer',
    deadlineFinal: true,
  };
}

export function decisionStateKey(handId, state = {}) {
  const hero = (state.hero || []).map(cardId).join(',');
  const board = (state.board || []).map(cardId).join(',');
  const actions = (state.actions || []).map((a) => `${a.type}:${Number.isFinite(a.amount) ? a.amount : '-'}`).join('|');
  return `${handId || 0}#${state.street || '-'}#${hero}#${board}#${Number.isFinite(state.pot) ? state.pot : '-'}#${actions}`;
}

export function setDecisionGate(gate) {
  decisionGate = typeof gate === 'function' ? gate : null;
}

export function publishDecision(entry) {
  const activeTurn = ensureTurnClock();

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
        reason: 'A trava de segurança da leitura não pôde validar esta decisão.',
        details: 'Nenhuma recomendação estratégica é liberada sem validação da mesa.',
        confidence: 0,
        source: 'study-safety-gate-r14',
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
        turnStartedAt,
      };
      next = { ...lockedFinal };
    } else if (next.decision === 'LEITURA INSUFICIENTE') {
      if (elapsed < HARD_DEADLINE_MS) {
        next = analyzingEntry(elapsed);
      } else {
        lockedFinal = conservativeDeadlineDecision(next, elapsed);
        next = { ...lockedFinal, finalDecision: true, lockedAt: nowMs(), turnStartedAt };
        lockedFinal = { ...next };
      }
    }
  }

  current = next;
  dispatchCurrent();
  return current;
}

export function clearDecision() {
  const activeTurn = ensureTurnClock();
  if (activeTurn) {
    if (lockedFinal) {
      current = { ...lockedFinal };
    } else {
      const elapsed = turnStartedAt ? nowMs() - turnStartedAt : 0;
      if (elapsed >= HARD_DEADLINE_MS) {
        lockedFinal = {
          ...conservativeDeadlineDecision(current, elapsed),
          finalDecision: true,
          lockedAt: nowMs(),
          turnStartedAt,
        };
        current = { ...lockedFinal };
      } else {
        current = analyzingEntry(elapsed, 'Ainda estou fechando a ação atual.');
      }
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
  if (!current) return null;
  if (lockedFinal && heroTurnActive()) return current;
  if (stateKey && current.stateKey !== stateKey) return null;
  return current;
}

function decisionWatchdog() {
  const hadTurn = turnStartedAt > 0;
  const activeTurn = ensureTurnClock();

  if (!activeTurn) {
    // If the Hero action has ended, do not leave an ANALISANDO/final fallback
    // stranded in the store while the resolver waits for its next tick.
    if (hadTurn && current && (current.decision === 'ANALISANDO' || current.finalDecision)) {
      current = null;
      dispatchCurrent();
    }
    return;
  }

  if (lockedFinal) return;
  const elapsed = turnStartedAt ? nowMs() - turnStartedAt : 0;
  if (elapsed >= HARD_DEADLINE_MS) {
    lockedFinal = {
      ...conservativeDeadlineDecision(current, elapsed),
      finalDecision: true,
      lockedAt: nowMs(),
      turnStartedAt,
    };
    current = { ...lockedFinal };
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
    fastTurnFallback: true,
    get locked() { return lockedFinal ? { ...lockedFinal } : null; },
    get elapsedMs() { return turnStartedAt ? nowMs() - turnStartedAt : 0; },
  };
  setInterval(decisionWatchdog, WATCHDOG_MS);
}
