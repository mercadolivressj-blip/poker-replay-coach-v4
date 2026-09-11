import { activeHandMachine } from '../core/state-machine.js';
import { PotConsensus } from '../detectors/pot.js';
import { observeStablePot } from '../core/stable-pot-consensus-r14.js';
import { formatAmount } from './money-runtime-r13.js';

const diagnostics = {
  handId: 0,
  heroRestores: 0,
  boardRestores: 0,
  potRestores: 0,
  lifecycleBlocks: 0,
  lastHero: '—',
  lastBoard: '—',
  lastPot: null,
};
if (typeof window !== 'undefined') window.__prcStateTransactionR14 = diagnostics;

const SUIT_SYMBOL = Object.freeze({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' });
const cloneCards = (cards) => (cards || []).map((c) => ({ ...c }));
const heroComplete = (cards) => Array.isArray(cards) && cards.length === 2 && cards.every((c) => c?.rank);
const boardComplete = (cards) => Array.isArray(cards) && [3, 4, 5].includes(cards.length) && cards.every((c) => c?.rank);
const cardLabel = (cards) => (cards || []).map((c) => `${c?.rank || '?'}${c?.suit ? (SUIT_SYMBOL[c.suit] || '?') : '?'}`).join(' ');

// Replace the monotonic R13 pot consensus with a temporal consensus that can
// correct an OCR outlier in either direction without using pot changes as a
// lifecycle signal.
PotConsensus.prototype.observe = function observeR14(value) {
  return observeStablePot(this, value);
};

function install(machine) {
  if (!machine || machine.__prcStateTransactionR14) return;

  const rawObserveHero = machine.observeHero.bind(machine);
  const rawObserveBoardCount = machine.observeBoardCount.bind(machine);

  // The base detector is allowed to create only the very first hand. After that,
  // redeals are owned by Hero Authority, which requires a sustained physical gap
  // plus a stable replacement pair. No other sensor may rotate the hand.
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

let stableHandId = -1;
let stableHero = null;
let stableBoard = null;
let stablePot = null;
let syncing = false;

function syncStableState() {
  if (syncing) return;
  const machine = activeHandMachine;
  if (!machine?.state) return;
  syncing = true;
  try {
    if (machine.handId !== stableHandId) {
      stableHandId = machine.handId;
      stableHero = null;
      stableBoard = null;
      stablePot = null;
      diagnostics.handId = machine.handId;
    }

    const state = machine.state;

    if (heroComplete(state.hero)) {
      stableHero = cloneCards(state.hero);
      diagnostics.lastHero = cardLabel(stableHero);
    } else if (stableHero) {
      state.hero = cloneCards(stableHero);
      diagnostics.heroRestores++;
    }

    if (boardComplete(state.board)) {
      if (!stableBoard || state.board.length >= stableBoard.length) {
        stableBoard = cloneCards(state.board);
        diagnostics.lastBoard = cardLabel(stableBoard);
      }
    } else if (stableBoard && ['flop', 'turn', 'river'].includes(state.street)) {
      state.board = cloneCards(stableBoard);
      diagnostics.boardRestores++;
    }

    if (Number.isFinite(state.pot) && state.pot > 0) {
      stablePot = state.pot;
      diagnostics.lastPot = state.pot;
    } else if (Number.isFinite(stablePot) && stablePot > 0) {
      state.pot = stablePot;
      diagnostics.potRestores++;
    }

    // Presentation is derived only from the committed snapshot. MutationObserver
    // runs in the same task turn as DOM changes, so a detector writing '—' cannot
    // visibly blink while the handId is unchanged.
    const heroEl = document.getElementById('heroCards');
    const boardEl = document.getElementById('boardCards');
    const potEl = document.getElementById('potValue');
    if (heroEl && stableHero) {
      const wanted = cardLabel(stableHero);
      if (heroEl.textContent !== wanted) heroEl.textContent = wanted;
    }
    if (boardEl && stableBoard && ['flop', 'turn', 'river'].includes(state.street)) {
      const wanted = cardLabel(stableBoard);
      if (boardEl.textContent !== wanted) boardEl.textContent = wanted;
    }
    if (potEl && Number.isFinite(stablePot) && stablePot > 0) {
      const wanted = formatAmount(stablePot);
      if (potEl.textContent !== wanted) potEl.textContent = wanted;
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
