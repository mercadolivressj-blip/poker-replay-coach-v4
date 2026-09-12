import { activeHandMachine } from '../core/state-machine.js';
import { PotConsensus } from '../detectors/pot.js';
import { DealSnapshotArbiter } from '../core/deal-snapshot-arbiter-r14.js';
import { observeStablePot } from '../core/stable-pot-consensus-r14.js';
import { formatAmount } from './money-runtime-r13.js';

const diagnostics = {
  handId: 0,
  heroRestores: 0,
  boardRestores: 0,
  potRestores: 0,
  lifecycleBlocks: 0,
  lockedHeroConflicts: 0,
  lockedBoardConflicts: 0,
  manualRefreshes: 0,
  manualOverrides: 0,
  manualRebinds: 0,
  fullPotBlocksDuringHeroTurn: 0,
  lastHero: '—',
  lastBoard: '—',
  lastPot: null,
};
if (typeof window !== 'undefined') window.__prcStateTransactionR14 = diagnostics;

const SUIT_SYMBOL = Object.freeze({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' });
const cardLabel = (cards) => (cards || []).map((c) => `${c?.rank || '?'}${c?.suit ? (SUIT_SYMBOL[c.suit] || '?') : '?'}`).join(' ');
const heroComplete = (cards) => Array.isArray(cards) && cards.length === 2 && cards.every((c) => c?.rank);

PotConsensus.prototype.observe = function observeR14(value) {
  return observeStablePot(this, value);
};

const arbiter = activeHandMachine ? new DealSnapshotArbiter(activeHandMachine) : null;
if (typeof window !== 'undefined' && arbiter) window.__prcDealArbiterR14 = arbiter;

function dispatchGeneration(machine, reason) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent('prc:generation-change', {
    detail: { generation: machine.handId, reason },
  }));
}

function dispatchRecalibration(token, source = 'refresh') {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined' || !token) return;
  window.dispatchEvent(new CustomEvent('prc:recalibrate', {
    detail: { token, generation: arbiter?.generation, source },
  }));
}

function fastDecisionOwnsPot(machine, fast) {
  if (!machine || !fast || Number(fast.handId) !== Number(machine.handId)) return false;
  const lifecycle = String(fast.trustReason || '').startsWith('Sua vez');
  const currentFrame = fast.heroToAct === true && Array.isArray(fast.actions) && fast.actions.length >= 2;
  const hasDecisionEvidence = Number(fast.lastSeenAt) > 0 && Number(fast.rawStableFrames) >= 1;
  return Boolean(hasDecisionEvidence && (machine.state?.heroToAct || lifecycle || currentFrame));
}

function install(machine) {
  if (!machine || machine.__prcStateTransactionR14 || !arbiter) return;

  const rawObserveHero = machine.observeHero.bind(machine);
  const rawNewHand = machine.newHand.bind(machine);

  machine.newHand = (reason, now = performance.now()) => {
    rawNewHand(reason, now);
    arbiter.syncGeneration(now);
    diagnostics.handId = machine.handId;
    dispatchGeneration(machine, reason);
  };

  machine.setHero = (cards, handId, options = {}) => {
    const beforeLocks = arbiter.diagnostics.heroLocks;
    const beforeRebinds = arbiter.diagnostics.manualRebinds;
    const result = arbiter.commitHero(cards, {
      generation: handId,
      rebindToken: options?.rebindToken || null,
      forceRebind: Boolean(options?.forceRebind),
      now: options?.now,
    });
    diagnostics.lockedHeroConflicts += arbiter.diagnostics.heroLocks - beforeLocks;
    diagnostics.manualRebinds += arbiter.diagnostics.manualRebinds - beforeRebinds;
    return result.accepted;
  };

  machine.setBoard = (cards, handId, options = {}) => {
    const beforeLocks = arbiter.diagnostics.boardLocks;
    const beforeRebinds = arbiter.diagnostics.manualRebinds;
    const result = arbiter.commitBoard(cards, {
      generation: handId,
      rebindToken: options?.rebindToken || null,
      forceRebind: Boolean(options?.forceRebind),
      now: options?.now,
    });
    diagnostics.lockedBoardConflicts += arbiter.diagnostics.boardLocks - beforeLocks;
    diagnostics.manualRebinds += arbiter.diagnostics.manualRebinds - beforeRebinds;
    return result.accepted;
  };

  machine.setPot = (value, handId, options = {}) => {
    const source = String(options?.source || 'local');
    const full = typeof window !== 'undefined' ? window.__prcAIStateR14 : null;
    const fast = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;

    // Once AI perception is active, local OCR is no longer allowed to replace
    // the authoritative pot. Full-frame owns context; fast-decision owns the
    // exact Hero decision window after it has produced a current snapshot.
    if (full?.enabled && Number(full.responses) > 0 && !['ai-full-frame', 'ai-decision', 'manual'].includes(source)) return false;

    // Do not require the legacy/local heroToAct flag here. The fast decision
    // lane may correctly recognize Hero's turn even when the local button
    // detector missed it. In that case its current pot must still outrank a
    // slower full-frame response captured earlier.
    const fastOwnsCurrentTurn = fastDecisionOwnsPot(machine, fast);
    if (source === 'ai-full-frame' && fastOwnsCurrentTurn) {
      diagnostics.fullPotBlocksDuringHeroTurn++;
      return false;
    }

    return arbiter.commitPot(value, { generation: handId, now: options?.now }).accepted;
  };

  machine.observeHero = (fp, present, now = performance.now()) => {
    if (machine.handId <= 0) return rawObserveHero(fp, present, now);
    if (!present) {
      machine.heroMissing = (machine.heroMissing || 0) + 1;
      return { newHand: false, reason: 'r14-hero-gap-observed' };
    }
    machine.heroMissing = 0;
    machine.lastHeroSeenAt = now;
    return { newHand: false, reason: 'r14-hero-observed' };
  };

  machine.observeBoardCount = (count, now = performance.now()) => {
    if (![0, 3, 4, 5].includes(count)) return { newHand: false, reason: null };
    if (count > 0) {
      machine.lastBoardCountVisual = Math.max(machine.lastBoardCountVisual || 0, count);
      machine.boardZeroHits = 0;
      machine.boardZeroSince = 0;
    } else if ((machine.lastBoardCountVisual || 0) > 0) {
      if (!machine.boardZeroSince) machine.boardZeroSince = now;
      machine.boardZeroHits = (machine.boardZeroHits || 0) + 1;
    }
    diagnostics.lifecycleBlocks++;
    return { newHand: false, reason: 'r14-board-observation-only' };
  };

  machine.observePotValue = () => {
    diagnostics.lifecycleBlocks++;
    return { newHand: false, reason: 'r14-pot-observation-only' };
  };

  machine.__prcStateTransactionR14 = true;
}

install(activeHandMachine);

export function requestReadingRecalibration() {
  if (!arbiter) return null;
  const token = arbiter.beginManualRecalibration();
  diagnostics.manualRefreshes++;
  dispatchRecalibration(token, 'automatic-refresh');
  if (typeof window !== 'undefined') setTimeout(() => window.__prcAIRefreshR14?.(), 0);
  return token;
}

export function applyManualReplayState({ hero, board, pot } = {}) {
  if (!arbiter || !activeHandMachine) return { accepted: false, reason: 'unavailable' };
  const hasHero = Array.isArray(hero);
  const hasBoard = Array.isArray(board);
  const hasPot = Number.isFinite(Number(pot)) && Number(pot) > 0;
  if (!hasHero && !hasBoard && !hasPot) return { accepted: false, reason: 'empty' };

  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const token = arbiter.beginManualRecalibration(now);
  const generation = arbiter.generation;
  const result = { accepted: true, generation, hero: null, board: null, pot: null };

  if (hasHero) {
    result.hero = activeHandMachine.setHero(hero, generation, { rebindToken: token, forceRebind: true, source: 'manual', now });
    result.accepted = result.accepted && result.hero;
  }
  if (hasBoard) {
    result.board = activeHandMachine.setBoard(board, generation, { rebindToken: token, forceRebind: true, source: 'manual', now });
    result.accepted = result.accepted && result.board;
  }
  if (hasPot) {
    result.pot = activeHandMachine.setPot(Number(pot), generation, { source: 'manual', now });
    result.accepted = result.accepted && result.pot;
  }

  arbiter.consumeManualRebind(token, 'hero', now);
  arbiter.consumeManualRebind(token, 'board', now);
  diagnostics.manualOverrides++;
  dispatchRecalibration(token, 'manual-override');

  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('prc:manual-state-applied', {
      detail: { generation, hero: hasHero, board: hasBoard, pot: hasPot },
    }));
  }
  return result;
}

if (typeof window !== 'undefined') {
  window.__prcRecalibrateReading = requestReadingRecalibration;
  window.__prcApplyManualReplayStateR14 = applyManualReplayState;
}

let syncing = false;
function syncStableState() {
  if (syncing || !arbiter) return;
  const machine = activeHandMachine;
  if (!machine?.state) return;
  syncing = true;
  try {
    const beforeHero = heroComplete(machine.state.hero);
    const beforeBoard = Array.isArray(machine.state.board) && machine.state.board.length > 0;
    const beforePot = Number.isFinite(machine.state.pot) && machine.state.pot > 0;
    const restored = arbiter.restore();
    const snapshot = arbiter.view();

    diagnostics.handId = snapshot.generation;
    diagnostics.lastHero = snapshot.hero.length ? cardLabel(snapshot.hero) : '—';
    diagnostics.lastBoard = snapshot.board.length ? cardLabel(snapshot.board) : '—';
    diagnostics.lastPot = snapshot.pot;
    if (restored) {
      if (!beforeHero && snapshot.hero.length) diagnostics.heroRestores++;
      if (!beforeBoard && snapshot.board.length) diagnostics.boardRestores++;
      if (!beforePot && snapshot.pot !== null) diagnostics.potRestores++;
    }

    const heroEl = document.getElementById('heroCards');
    const boardEl = document.getElementById('boardCards');
    const potEl = document.getElementById('potValue');
    const streetEl = document.getElementById('streetValue');

    if (heroEl) {
      const wanted = snapshot.hero.length ? cardLabel(snapshot.hero) : '—';
      if (heroEl.textContent !== wanted) heroEl.textContent = wanted;
    }
    if (boardEl) {
      const wanted = snapshot.board.length ? cardLabel(snapshot.board) : '—';
      if (boardEl.textContent !== wanted) boardEl.textContent = wanted;
    }
    if (potEl) {
      const wanted = snapshot.pot !== null ? formatAmount(snapshot.pot) : '—';
      if (potEl.textContent !== wanted) potEl.textContent = wanted;
    }
    if (streetEl) {
      const wanted = snapshot.street || 'preflop';
      if (streetEl.textContent !== wanted) streetEl.textContent = wanted;
    }
  } finally {
    syncing = false;
  }
}

if (typeof document !== 'undefined') {
  const target = document.querySelector('.coach-card') || document.body;
  if (target && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(syncStableState);
    observer.observe(target, { subtree: true, childList: true, characterData: true });
  }
  setInterval(syncStableState, 24);
  setTimeout(syncStableState, 0);
}
