import { cardId } from '../solver/hand-evaluator.js';
import { activeHandMachine } from './state-machine.js';

let current = null;
let decisionGate = null;
let lockedFinal = null;
let turnStartedAt = 0;
let deadlineReached = false;

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

function heroTurnActive() {
  return Boolean(activeHandMachine?.state?.heroToAct || uiHeroTurn() || fastTurnSignal());
}

function manualHeroReadyForDecision() {
  const machine = activeHandMachine;
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

function resetTurnLock() {
  lockedFinal = null;
  turnStartedAt = 0;
  deadlineReached = false;
}

export function decisionStateKey(handId, state = {}) {
  const hero = (state.hero || []).map(cardId).join(',');
  const board = (state.board || []).map(cardId).join(',');
  const actions = (state.actions || []).map((a) => `${a.type}:${Number.isFinite(a.amount) ? a.amount : '-'}`).join('|');
  return `${handId || 0}#${state.street || '-'}#${hero}#${board}#${Number.isFinite(state.pot) ? state.pot : '-'}#${actions}`;
}

export function decisionEpochKey(handId, state = {}) {
  const hero = (state.hero || []).map(cardId).join(',');
  const board = (state.board || []).map(cardId).join(',');
  const actions = (state.actions || []).map((a) => `${a.type}:${Number.isFinite(a.amount) ? a.amount : '-'}`).join('|');
  return `${handId || 0}#${state.street || '-'}#${hero}#${board}#${actions}`;
}

function currentStateKey() {
  const machine = activeHandMachine;
  return machine ? decisionStateKey(machine.handId, machine.state) : '0#-';
}

function currentEpochKey() {
  const machine = activeHandMachine;
  return machine ? decisionEpochKey(machine.handId, machine.state) : '0#-';
}

function invalidateStaleLock() {
  if (!lockedFinal) return false;
  const liveEpoch = currentEpochKey();
  if (lockedFinal.epochKey === liveEpoch) return false;

  lockedFinal = null;
  current = null;
  deadlineReached = false;
  turnStartedAt = heroTurnActive() && manualHeroReadyForDecision() ? nowMs() : 0;
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
  const suffix = heroReady
    ? ` Vou tentar fechar uma leitura confiável em até ${Math.max(0, Math.ceil((HARD_DEADLINE_MS - elapsed) / 1000))}s.`
    : ' O relógio estratégico só começa depois que suas duas cartas manuais forem confirmadas.';
  return {
    stateKey: currentStateKey(),
    decision: 'ANALISANDO',
    reason: `${reason}${suffix}`,
    details: 'Núcleo atual: Hero manual, board, pote, stacks, jogadores ativos, posição/dealer e ação atual. Histórico completo apenas refina range/confiança.',
    confidence: 0,
    source: 'r14-decision-finalizer',
  };
}

function deadlineInsufficientDecision(entry, elapsed) {
  return {
    ...(entry || {}),
    stateKey: entry?.stateKey || currentStateKey(),
    decision: 'LEITURA INSUFICIENTE',
    reason: 'O prazo terminou sem o núcleo atual ficar confiável. O Coach não vai inventar uma ação.',
    details: `SEM DECISÃO ESTRATÉGICA POR PRAZO · ${Math.round(elapsed)}ms · se o estado atual confiável chegar enquanto ainda for sua vez, ele poderá substituir este aviso.`,
    confidence: 0,
    source: 'r14-decision-deadline-insufficient',
    deadlineFinal: true,
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
      };
      next = { ...lockedFinal };
    } else if (next.decision === 'LEITURA INSUFICIENTE') {
      if (!manualHeroReadyForDecision() || (elapsed < HARD_DEADLINE_MS && !deadlineReached)) {
        next = analyzingEntry(elapsed);
      } else {
        deadlineReached = true;
        next = deadlineInsufficientDecision(next, elapsed);
      }
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
      if (manualHeroReadyForDecision() && (elapsed >= HARD_DEADLINE_MS || deadlineReached)) {
        deadlineReached = true;
        current = deadlineInsufficientDecision(current, elapsed);
      } else {
        current = analyzingEntry(elapsed, manualHeroReadyForDecision() ? 'Ainda estou fechando a ação atual.' : 'Aguardando suas duas cartas manuais.');
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
      current = analyzingEntry(0, 'Aguardando suas duas cartas manuais.');
      dispatchCurrent();
    }
    return;
  }

  const elapsed = turnStartedAt ? nowMs() - turnStartedAt : 0;
  if (elapsed >= HARD_DEADLINE_MS) {
    if (!deadlineReached || current?.decision !== 'LEITURA INSUFICIENTE' || !current?.deadlineFinal) {
      deadlineReached = true;
      current = deadlineInsufficientDecision(current, elapsed);
      dispatchCurrent();
    }
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
    strategicDeadlineFallback: false,
    clockStartsAfterManualHero: true,
    lockFollowsDecisionEpoch: true,
    get locked() { return lockedFinal ? { ...lockedFinal } : null; },
    get deadlineReached() { return deadlineReached; },
    get elapsedMs() { return turnStartedAt ? nowMs() - turnStartedAt : 0; },
  };
  setInterval(decisionWatchdog, WATCHDOG_MS);
}
