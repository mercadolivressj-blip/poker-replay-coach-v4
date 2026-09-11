import { cardId } from '../solver/hand-evaluator.js';

let current = null;

export function decisionStateKey(handId, state = {}) {
  const hero = (state.hero || []).map(cardId).join(',');
  const board = (state.board || []).map(cardId).join(',');
  const actions = (state.actions || []).map((a) => `${a.type}:${Number.isFinite(a.amount) ? a.amount : '-'}`).join('|');
  return `${handId || 0}#${state.street || '-'}#${hero}#${board}#${Number.isFinite(state.pot) ? state.pot : '-'}#${actions}`;
}

export function publishDecision(entry) {
  current = entry ? { ...entry } : null;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('prc:decision', { detail: current }));
  return current;
}

export function clearDecision() {
  current = null;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('prc:decision', { detail: null }));
}

export function getDecision(stateKey = null) {
  if (!current) return null;
  if (stateKey && current.stateKey !== stateKey) return null;
  return current;
}
