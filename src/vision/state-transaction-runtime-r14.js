import { activeHandMachine } from '../core/state-machine.js';
import { PotConsensus } from '../detectors/pot.js';
import { DealSnapshotArbiter } from '../core/deal-snapshot-arbiter-r14.js';
import { DealLifecycleR14 } from '../core/deal-lifecycle-r14.js';
import { observeStablePot } from '../core/stable-pot-consensus-r14.js';
import { formatAmount } from './money-runtime-r13.js';

const diagnostics = {
  handId: 0,
  heroRestores: 0,
  boardRestores: 0,
  potRestores: 0,
  lifecycleBlocks: 0,
  physicalRedeals: 0,
  deferredHeroRedeals: 0,
  suppressedHeroRedeals: 0,
  deferredBoardClears: 0,
  suppressedBoardClears: 0,
  boardClearRedeals: 0,
  lockedHeroConflicts: 0,
  lockedBoardConflicts: 0,
  potRegressionBlocks: 0,
  manualRefreshes: 0,
  manualOverrides: 0,
  manualRebinds: 0,
  fullPotBlocksDuringHeroTurn: 0,
  visualBoardCount: 0,
  visualBoardHits: 0,
  heroGapArmed: false,
  boardClearArmed: false,
  lastLifecycleReason: 'boot',
  lastGenerationReason: 'boot',
  lastHero: '—',
  lastBoard: '—',
  lastPot: null,
};
if (typeof window !== 'undefined') window.__prcStateTransactionR14 = diagnostics;

const SUIT_SYMBOL = Object.freeze({ clubs: '♣', diamonds: '♦', hearts: '♥', spades: '♠' });
const cardLabel = (cards) => (cards || []).map((c) => `${c?.rank || '?'}${c?.suit ? (SUIT_SYMBOL[c.suit] || '?') : '?'}`).join(' ');
const heroComplete = (cards) => Array.isArray(cards) && cards.length === 2 && cards.every((c) => c?.rank);
const BOARD_CLEAR_GRACE_MS = 500;

PotConsensus.prototype.observe = function observeR14(value) {
  return observeStablePot(this, value);
};

const arbiter = activeHandMachine ? new DealSnapshotArbiter(activeHandMachine) : null;
const lifecycle = new DealLifecycleR14();
if (typeof window !== 'undefined' && arbiter) {
  window.__prcDealArbiterR14 = arbiter;
  window.__prcPublicLifecycleR14 = {
    view: () => lifecycle.view(),
    get generation() { return lifecycle.generation; },
    get heroGapArmed() { return lifecycle.heroGapArmed; },
    get boardClearArmed() { return lifecycle.boardClearArmed; },
    get visualBoardCount() { return lifecycle.visualBoardCount; },
    get visualBoardHits() { return lifecycle.visualBoardHits; },
    get visualBoardUpdatedAt() { return lifecycle.visualBoardUpdatedAt; },
  };
}

function syncLifecycleDiagnostics() {
  const view = lifecycle.view();
  diagnostics.visualBoardCount = view.visualBoardCount;
  diagnostics.visualBoardHits = view.visualBoardHits;
  diagnostics.heroGapArmed = view.heroGapArmed;
  diagnostics.boardClearArmed = view.boardClearArmed;
  diagnostics.lastLifecycleReason = view.lastReason;
}

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
  const lifecycleSignal = String(fast.trustReason || '').startsWith('Sua vez');
  const currentFrame = fast.heroToAct === true && Array.isArray(fast.actions) && fast.actions.length >= 2;
  const hasDecisionEvidence = Number(fast.lastSeenAt) > 0 && Number(fast.rawStableFrames) >= 1;
  return Boolean(hasDecisionEvidence && (machine.state?.heroToAct || lifecycleSignal || currentFrame));
}

function install(machine) {
  if (!machine || machine.__prcStateTransactionR14 || !arbiter) return;

  const rawObserveHero = machine.observeHero.bind(machine);
  const rawNewHand = machine.newHand.bind(machine);
  let pendingHeroRedeal = null;
  let pendingBoardClear = null;

  machine.newHand = (reason, now = performance.now()) => {
    pendingHeroRedeal = null;
    pendingBoardClear = null;
    rawNewHand(reason, now);
    arbiter.syncGeneration(now);
    lifecycle.reset(machine.handId, now);
    diagnostics.handId = machine.handId;
    diagnostics.lastGenerationReason = reason || 'unknown';
    syncLifecycleDiagnostics();
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

    if (full?.enabled && Number(full.responses) > 0 && !['ai-full-frame', 'ai-decision', 'manual'].includes(source)) return false;

    const fastOwnsCurrentTurn = fastDecisionOwnsPot(machine, fast);
    if (source === 'ai-full-frame' && fastOwnsCurrentTurn) {
      diagnostics.fullPotBlocksDuringHeroTurn++;
      return false;
    }

    const beforeBlocks = arbiter.diagnostics.potRegressionBlocks || 0;
    const accepted = arbiter.commitPot(value, { generation: handId, source, now: options?.now }).accepted;
    diagnostics.potRegressionBlocks += (arbiter.diagnostics.potRegressionBlocks || 0) - beforeBlocks;
    return accepted;
  };

  // Hero animation can briefly disappear between streets. A postflop hand is
  // therefore never rotated only because Hero disappeared/reappeared while the
  // logical board is still alive. The board lane owns that boundary.
  machine.observeHero = (fp, present, now = performance.now()) => {
    if (machine.handId <= 0) {
      const out = rawObserveHero(fp, present, now);
      if (out?.newHand && present) lifecycle.seedHeroPresence(true, now);
      syncLifecycleDiagnostics();
      return out;
    }

    if (pendingHeroRedeal && pendingHeroRedeal.handId !== machine.handId) pendingHeroRedeal = null;
    if (pendingHeroRedeal) {
      const boardLive = Boolean((machine.state?.board || []).length > 0 || Number(lifecycle.visualBoardCount) > 0);
      if (boardLive) {
        pendingHeroRedeal = null;
        diagnostics.suppressedHeroRedeals++;
        if (present) lifecycle.seedHeroPresence(true, now);
        syncLifecycleDiagnostics();
        return { newHand: false, reason: 'r14-hero-redeal-suppressed-board-live' };
      }
      if (present && now > pendingHeroRedeal.armedAt) {
        const reason = pendingHeroRedeal.reason;
        pendingHeroRedeal = null;
        diagnostics.physicalRedeals++;
        machine.newHand(reason, now);
        lifecycle.seedHeroPresence(true, now);
        syncLifecycleDiagnostics();
        return { newHand: true, reason };
      }
    }

    const observed = lifecycle.observeHero(Boolean(present), now);
    if (!present) machine.heroMissing = (machine.heroMissing || 0) + 1;
    else {
      machine.heroMissing = 0;
      machine.lastHeroSeenAt = now;
    }

    if (observed.newDeal) {
      const reason = `r14-${observed.reason}`;
      const logicalBoardCount = Array.isArray(machine.state?.board) ? machine.state.board.length : 0;
      const boardLive = Boolean(logicalBoardCount > 0 || Number(lifecycle.visualBoardCount) > 0);

      if (logicalBoardCount > 0) {
        if (lifecycle.boardClearArmed && !pendingBoardClear) {
          pendingBoardClear = {
            handId: machine.handId,
            previousCount: logicalBoardCount,
            armedAt: now,
            heroRedealReason: reason,
          };
          diagnostics.deferredBoardClears++;
        }
        diagnostics.suppressedHeroRedeals++;
        lifecycle.seedHeroPresence(true, now);
        syncLifecycleDiagnostics();
        return { newHand: false, reason: 'r14-hero-redeal-suppressed-postflop' };
      }

      if (boardLive && !lifecycle.boardClearArmed) {
        diagnostics.suppressedHeroRedeals++;
        lifecycle.seedHeroPresence(true, now);
        syncLifecycleDiagnostics();
        return { newHand: false, reason: 'r14-hero-redeal-suppressed-board-live' };
      }

      if (!lifecycle.boardClearArmed) {
        pendingHeroRedeal = { handId: machine.handId, reason, armedAt: now };
        diagnostics.deferredHeroRedeals++;
        lifecycle.seedHeroPresence(true, now);
        syncLifecycleDiagnostics();
        return { newHand: false, reason: 'r14-hero-redeal-pending-board-check' };
      }

      diagnostics.physicalRedeals++;
      machine.newHand(reason, now);
      lifecycle.seedHeroPresence(true, now);
      syncLifecycleDiagnostics();
      return { newHand: true, reason };
    }

    syncLifecycleDiagnostics();
    return { newHand: false, reason: `r14-${observed.reason || 'hero-observed'}` };
  };

  // A physical board clear is first treated as a candidate boundary. PokerStars
  // can momentarily make the board detector read zero while dealing turn/river.
  // Keep the current generation for a short grace window; a board that returns
  // with the same or larger count proves this is the SAME hand. A genuinely
  // empty board that survives the grace window still rotates the generation so
  // stale river/pot/actions cannot leak into the next deal.
  machine.observeBoardCount = (count, now = performance.now()) => {
    if (![0, 3, 4, 5].includes(count)) return { newHand: false, reason: null };
    const logicalBoardCount = Array.isArray(machine.state?.board) ? machine.state.board.length : 0;
    const hadLogicalBoard = logicalBoardCount > 0;
    lifecycle.observeBoardCount(count, now);
    machine.lastBoardCountVisual = count;
    if (count === 0) machine.boardZeroHits = lifecycle.visualBoardHits;
    else machine.boardZeroHits = 0;

    if (count > 0 && pendingHeroRedeal && pendingHeroRedeal.handId === machine.handId) {
      pendingHeroRedeal = null;
      diagnostics.suppressedHeroRedeals++;
      lifecycle.seedHeroPresence(true, now);
    }

    if (count > 0 && pendingBoardClear && pendingBoardClear.handId === machine.handId) {
      const previousCount = Number(pendingBoardClear.previousCount) || logicalBoardCount;
      if (count >= previousCount) {
        pendingBoardClear = null;
        diagnostics.suppressedBoardClears++;
        lifecycle.seedHeroPresence(true, now);
        syncLifecycleDiagnostics();
        diagnostics.lifecycleBlocks++;
        return { newHand: false, reason: 'r14-board-clear-cancelled-street-continues' };
      }

      const reason = 'r14-board-redeal-after-clear';
      diagnostics.boardClearRedeals++;
      machine.newHand(reason, now);
      lifecycle.observeBoardCount(count, now);
      syncLifecycleDiagnostics();
      return { newHand: true, reason };
    }

    syncLifecycleDiagnostics();
    diagnostics.lifecycleBlocks++;

    if (count === 0 && hadLogicalBoard && lifecycle.boardClearArmed) {
      if (!pendingBoardClear || pendingBoardClear.handId !== machine.handId) {
        pendingBoardClear = {
          handId: machine.handId,
          previousCount: logicalBoardCount,
          armedAt: now,
          heroRedealReason: null,
        };
        diagnostics.deferredBoardClears++;
        return { newHand: false, reason: 'r14-board-clear-pending-grace' };
      }

      if (now - pendingBoardClear.armedAt < BOARD_CLEAR_GRACE_MS) {
        return { newHand: false, reason: 'r14-board-clear-pending-grace' };
      }

      const reason = 'r14-board-cleared-postflop';
      diagnostics.boardClearRedeals++;
      machine.newHand(reason, now);
      syncLifecycleDiagnostics();
      return { newHand: true, reason };
    }

    return { newHand: false, reason: lifecycle.boardClearArmed ? 'r14-board-clear-armed' : 'r14-board-observation' };
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
    syncLifecycleDiagnostics();
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
