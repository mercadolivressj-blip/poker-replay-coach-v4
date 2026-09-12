import { cardId } from '../solver/hand-evaluator.js';
import { activeHandMachine } from './state-machine.js';

let current = null;
let decisionGate = null;
let lockedFinal = null;
let turnStartedAt = 0;

const STRATEGIC = new Set(['PAGAR','DESISTIR','PASSAR','APOSTAR','AUMENTAR','ALL-IN']);
const HARD_DEADLINE_MS = 7000;

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

function heroTurnActive() {
  return Boolean(activeHandMachine?.state?.heroToAct || uiHeroTurn());
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

function conservativeDeadlineDecision(entry, elapsed) {
  const types = availableActionTypes();
  let decision = null;
  if (types.has('check')) decision = 'PASSAR';
  else if (types.has('fold')) decision = 'DESISTIR';
  else if (types.has('call')) decision = 'PAGAR';
  else if (types.has('bet')) decision = 'APOSTAR';
  else if (types.has('raise')) decision = 'AUMENTAR';
  else if (types.has('allin')) decision = 'ALL-IN';
  else decision = 'DESISTIR';

  return {
    ...entry,
    decision,
    reason: decision === 'PASSAR'
      ? 'Prazo de decisão atingido sem snapshot completo; linha conservadora: PASSAR sem investir fichas.'
      : decision === 'DESISTIR'
        ? 'Prazo de decisão atingido sem snapshot completo; linha conservadora: DESISTIR em vez de investir com informação incompleta.'
        : `Prazo de decisão atingido; ${decision} é a única ação utilizável confirmada no estado atual.`,
    details: `DECISÃO FINAL POR PRAZO · ${Math.round(elapsed)}ms · o Coach não muda esta ação até o Hero agir.`,
    confidence: Math.min(Number(entry?.confidence) || 0, 35) || 25,
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
        next = {
          ...next,
          decision: 'ANALISANDO',
          reason: `Fechando o snapshot desta decisão. Vou publicar uma ação final em até ${Math.max(0, Math.ceil((HARD_DEADLINE_MS - elapsed) / 1000))}s.`,
          details: 'Cartas, board, pote e ações estão sendo confirmados antes de congelar a recomendação.',
          confidence: 0,
          source: 'r14-decision-finalizer',
        };
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
    if (lockedFinal) current = { ...lockedFinal };
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

if (typeof window !== 'undefined') {
  window.__prcDecisionFinalizerR14 = {
    deadlineMs: HARD_DEADLINE_MS,
    get locked() { return lockedFinal ? { ...lockedFinal } : null; },
    get elapsedMs() { return turnStartedAt ? nowMs() - turnStartedAt : 0; },
  };
}
