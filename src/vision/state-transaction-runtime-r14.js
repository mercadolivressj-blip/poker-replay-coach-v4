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
  manualRebinds: 0,
  lastHero: '—',
  lastBoard: '—',
  lastPot: null,
};
if (typeof window !== 'undefined') window.__prcStateTransactionR14 = diagnostics;

const SUIT_SYMBOL = Object.freeze({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' });
const cardLabel = (cards) => (cards || []).map((c) => `${c?.rank || '?'}${c?.suit ? (SUIT_SYMBOL[c.suit] || '?') : '?'}`).join(' ');
const heroComplete = (cards) => Array.isArray(cards) && cards.length === 2 && cards.every((c) => c?.rank);

// Replace the monotonic R13 pot consensus with a temporal consensus that can
// correct OCR mistakes without allowing pot changes to rotate the hand.
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
      now: options?.now,
    });
    diagnostics.lockedBoardConflicts += arbiter.diagnostics.boardLocks - beforeLocks;
    diagnostics.manualRebinds += arbiter.diagnostics.manualRebinds - beforeRebinds;
    return result.accepted;
  };

  machine.setPot = (value, handId, options = {}) => arbiter.commitPot(value, {
    generation: handId,
    now: options?.now,
  }).accepted;

  // The base detector can create only the first generation. After that, redeals
  // are owned by Hero Authority and require a sustained physical card gap plus a
  // stable replacement pair. Rank disagreement alone can never rotate a hand.
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
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('prc:recalibrate', {
      detail: { token, generation: arbiter.generation },
    }));
  }
  return token;
}

if (typeof window !== 'undefined') window.__prcRecalibrateReading = requestReadingRecalibration;

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

    // Presentation is derived from the same generation-locked snapshot. A bad
    // frame can no longer render a transient contradiction, and a new generation
    // starts from a clean snapshot rather than inheriting the old river state.
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
    if (streetEl && snapshot.board.length) {
      if (streetEl.textContent !== snapshot.street) streetEl.textContent = snapshot.street;
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
