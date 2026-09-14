import { activeHandMachine } from '../core/state-machine.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';

const diagnostics = {
  enabled: true,
  suppressedGenerationChanges: 0,
  correctedBoardResults: 0,
  deferredPreflopHeroBoundaries: 0,
  cancelledPreflopHeroBoundaries: 0,
  committedPreflopHeroBoundaries: 0,
  deferredBoardBoundaries: 0,
  cancelledBoardBoundaries: 0,
  committedBoardBoundaries: 0,
  confirmedPreflopByDealer: 0,
  // Kept for backwards diagnostics. Pot reset is deliberately no longer proof.
  confirmedPreflopByPotReset: 0,
  blockedPotOnlyBoundaries: 0,
  dealerProofHits: 0,
  preflopBoundaryPending: false,
  boardBoundaryPending: false,
  lastBoundaryEvidence: null,
  lastReason: 'boot',
};

const HERO_RECENT_MS = 1000;
const PREFLOP_REDEAL_GRACE_MS = 250;
const DEALER_CONFIRM_HITS = 2;
const PREFLOP_HERO_REDEAL_REASON = 'r14-physical-hero-redeal';
const BOARD_BOUNDARY_REASONS = new Set([
  'r14-board-cleared-postflop',
  'r14-board-redeal-after-clear',
]);

let pendingPreflopHeroBoundary = null;
let pendingBoardBoundary = null;
let committingPendingBoundary = false;
let lastStableDealerSeat = null;
let lastStablePublicPot = null;

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function heroComplete(machine) {
  const hero = machine?.state?.hero || [];
  return hero.length === 2 && hero.every((card) => card?.rank && card?.suit);
}

function heroRecentlyPhysical(machine, at = nowMs()) {
  const lastSeen = Number(machine?.lastHeroSeenAt) || 0;
  return lastSeen > 0 && at - lastSeen <= HERO_RECENT_MS;
}

function authorityLocked(machine) {
  if (typeof window === 'undefined') return false;
  const authority = window.__prcManualHeroAuthorityR14;
  return Boolean(
    authority?.heroLocked
    && Number(authority.handId) === Number(machine?.handId)
    && heroComplete(machine)
  );
}

function postflopAlive(machine) {
  return Array.isArray(machine?.state?.board) && machine.state.board.length >= 3;
}

function publicLifecycleView() {
  const life = typeof window !== 'undefined' ? window.__prcPublicLifecycleR14 : null;
  return typeof life?.view === 'function' ? life.view() : life;
}

function physicalBoardCount() {
  const life = publicLifecycleView();
  return Number.isFinite(Number(life?.visualBoardCount)) ? Number(life.visualBoardCount) : null;
}

function physicalBoardVisible() {
  return Number(physicalBoardCount()) > 0;
}

function currentDealerSeat() {
  const tableSeats = activeTableStateTracker?.latest?.seats;
  const tableDealer = Array.isArray(tableSeats) ? tableSeats.find((seat) => seat?.dealer) : null;
  if (Number.isInteger(tableDealer?.seatIndex)) return tableDealer.seatIndex;

  if (typeof window !== 'undefined') {
    const fullSeats = window.__prcAIStateR14?.seats;
    const fullDealer = Array.isArray(fullSeats) ? fullSeats.find((seat) => seat?.dealer) : null;
    if (Number.isInteger(fullDealer?.seatIndex)) return fullDealer.seatIndex;
  }
  return null;
}

function rememberedHeroDealerSeat() {
  if (typeof window === 'undefined') return null;
  const seat = window.__prcManualHeroEntryR14?.lastHeroAppliedDealerSeat;
  return Number.isInteger(seat) ? seat : null;
}

function boundaryDealerBaseline() {
  if (Number.isInteger(lastStableDealerSeat)) return lastStableDealerSeat;
  const remembered = rememberedHeroDealerSeat();
  if (Number.isInteger(remembered)) return remembered;
  return currentDealerSeat();
}

function stablePublicPot(machine) {
  if (typeof window !== 'undefined') {
    const fast = window.__prcAIDecisionR14;
    const fastPot = Number(fast?.pot);
    if (Number(fast?.rawStableFrames) >= 2 && Number.isFinite(fastPot) && fastPot > 0) return fastPot;

    const full = window.__prcAIStateR14;
    const fullPot = Number(full?.pot);
    if (Number(full?.potConfidence) >= 0.80 && Number.isFinite(fullPot) && fullPot > 0) return fullPot;
  }

  const logical = Number(machine?.state?.pot);
  return Number.isFinite(logical) && logical > 0 ? logical : null;
}

function rememberStableBoundaryBaseline(machine, present) {
  if (!present || pendingPreflopHeroBoundary || pendingBoardBoundary || physicalBoardVisible()) return;
  const life = publicLifecycleView();
  if (life?.heroGapArmed) return;

  const dealer = currentDealerSeat();
  if (Number.isInteger(dealer)) lastStableDealerSeat = dealer;
  const pot = stablePublicPot(machine);
  if (Number.isFinite(pot) && pot > 0) lastStablePublicPot = pot;
}

function newPending(machine, reason, at) {
  return {
    handId: machine.handId,
    reason: String(reason || ''),
    armedAt: at,
    baselineDealerSeat: boundaryDealerBaseline(),
    baselinePot: Number.isFinite(lastStablePublicPot) ? lastStablePublicPot : stablePublicPot(machine),
    candidateDealer: null,
    dealerHits: 0,
  };
}

function dealerProof(machine, pending) {
  const dealer = currentDealerSeat();
  const pot = stablePublicPot(machine);
  const baselineDealer = Number.isInteger(pending?.baselineDealerSeat) ? pending.baselineDealerSeat : null;
  const baselinePot = Number.isFinite(pending?.baselinePot) ? pending.baselinePot : null;

  const dealerChanged = baselineDealer !== null && Number.isInteger(dealer) && dealer !== baselineDealer;
  if (dealerChanged) {
    if (pending.candidateDealer === dealer) pending.dealerHits++;
    else {
      pending.candidateDealer = dealer;
      pending.dealerHits = 1;
    }
  } else {
    pending.candidateDealer = null;
    pending.dealerHits = 0;
  }

  const potReset = Number.isFinite(baselinePot)
    && baselinePot > 0
    && Number.isFinite(pot)
    && pot > 0
    && pot <= baselinePot * 0.72
    && baselinePot - pot >= Math.max(0.01, baselinePot * 0.20);

  if (potReset && !dealerChanged) diagnostics.blockedPotOnlyBoundaries++;
  diagnostics.dealerProofHits = pending.dealerHits;

  return {
    confirmed: dealerChanged && pending.dealerHits >= DEALER_CONFIRM_HITS,
    dealerChanged,
    dealerHits: pending.dealerHits,
    potReset,
    potResetAccepted: false,
    baselineDealer,
    dealer,
    baselinePot,
    pot,
  };
}

function shouldProtect(machine, reason, at = nowMs()) {
  return BOARD_BOUNDARY_REASONS.has(String(reason || ''))
    && postflopAlive(machine)
    && heroComplete(machine)
    && (heroRecentlyPhysical(machine, at) || authorityLocked(machine));
}

function shouldDeferPreflopHeroBoundary(machine, reason) {
  return String(reason || '') === PREFLOP_HERO_REDEAL_REASON
    && !postflopAlive(machine)
    && heroComplete(machine);
}

function shouldDeferBoardBoundary(machine, reason) {
  return BOARD_BOUNDARY_REASONS.has(String(reason || ''))
    && postflopAlive(machine)
    && heroComplete(machine);
}

function cancelPendingPreflop(reason = 'board-visible') {
  if (!pendingPreflopHeroBoundary) return false;
  pendingPreflopHeroBoundary = null;
  diagnostics.preflopBoundaryPending = false;
  diagnostics.cancelledPreflopHeroBoundaries++;
  diagnostics.lastReason = `preflop-boundary-cancelled:${reason}`;
  return true;
}

function cancelPendingBoard(reason = 'board-returned') {
  if (!pendingBoardBoundary) return false;
  pendingBoardBoundary = null;
  diagnostics.boardBoundaryPending = false;
  diagnostics.cancelledBoardBoundaries++;
  diagnostics.lastReason = `board-boundary-cancelled:${reason}`;
  return true;
}

function maybeCommitPending(machine, kind, at = nowMs()) {
  const pending = kind === 'board' ? pendingBoardBoundary : pendingPreflopHeroBoundary;
  if (!pending || pending.handId !== machine.handId) return null;
  if (physicalBoardVisible()) return null;

  const evidence = dealerProof(machine, pending);
  diagnostics.lastBoundaryEvidence = evidence;
  if (!evidence.confirmed) {
    diagnostics.lastReason = kind === 'board'
      ? 'board-boundary-awaiting-stable-dealer-move'
      : 'preflop-hero-boundary-awaiting-stable-dealer-move';
    return null;
  }

  if (kind === 'board') {
    pendingBoardBoundary = null;
    diagnostics.boardBoundaryPending = false;
  } else {
    pendingPreflopHeroBoundary = null;
    diagnostics.preflopBoundaryPending = false;
  }

  const before = machine.handId;
  committingPendingBoundary = true;
  try {
    machine.newHand(pending.reason, at);
  } finally {
    committingPendingBoundary = false;
  }

  if (machine.handId === before) return null;
  lastStableDealerSeat = evidence.dealer;
  lastStablePublicPot = evidence.pot;
  diagnostics.dealerProofHits = 0;

  if (kind === 'board') {
    diagnostics.committedBoardBoundaries++;
    diagnostics.lastReason = 'board-boundary-confirmed-dealer-moved-2of2';
  } else {
    diagnostics.committedPreflopHeroBoundaries++;
    diagnostics.confirmedPreflopByDealer++;
    diagnostics.lastReason = 'preflop-hero-boundary-confirmed-dealer-moved-2of2';
  }
  return { newHand: true, reason: pending.reason };
}

function install(machine) {
  if (!machine || machine.__prcHeroContinuityGuardR14) return;

  const transactionNewHand = machine.newHand.bind(machine);
  const transactionObserveHero = machine.observeHero.bind(machine);
  const transactionObserveBoardCount = machine.observeBoardCount.bind(machine);

  machine.newHand = (reason, at = nowMs()) => {
    if (committingPendingBoundary) {
      diagnostics.lastReason = `allowed-confirmed:${reason || 'unknown'}`;
      return transactionNewHand(reason, at);
    }

    if (shouldDeferBoardBoundary(machine, reason)) {
      if (!pendingBoardBoundary || pendingBoardBoundary.handId !== machine.handId) {
        pendingBoardBoundary = newPending(machine, reason, at);
        diagnostics.deferredBoardBoundaries++;
      }
      diagnostics.boardBoundaryPending = true;
      diagnostics.suppressedGenerationChanges++;
      diagnostics.lastBoundaryEvidence = null;
      diagnostics.lastReason = `board-boundary-pending-dealer-proof:${reason}`;
      return false;
    }

    if (shouldDeferPreflopHeroBoundary(machine, reason)) {
      if (!pendingPreflopHeroBoundary || pendingPreflopHeroBoundary.handId !== machine.handId) {
        pendingPreflopHeroBoundary = newPending(machine, reason, at);
        diagnostics.deferredPreflopHeroBoundaries++;
      }
      diagnostics.preflopBoundaryPending = true;
      diagnostics.lastBoundaryEvidence = null;
      diagnostics.lastReason = 'preflop-hero-boundary-pending-dealer-proof';
      return false;
    }

    pendingPreflopHeroBoundary = null;
    pendingBoardBoundary = null;
    diagnostics.preflopBoundaryPending = false;
    diagnostics.boardBoundaryPending = false;
    diagnostics.lastReason = `allowed:${reason || 'unknown'}`;
    return transactionNewHand(reason, at);
  };

  machine.observeHero = (fp, present, at = nowMs()) => {
    if (pendingPreflopHeroBoundary && pendingPreflopHeroBoundary.handId !== machine.handId) cancelPendingPreflop('generation-changed');
    if (pendingBoardBoundary && pendingBoardBoundary.handId !== machine.handId) cancelPendingBoard('generation-changed');

    if (pendingBoardBoundary) {
      const committed = maybeCommitPending(machine, 'board', at);
      if (committed) return committed;
    }

    if (pendingPreflopHeroBoundary) {
      if (physicalBoardVisible()) cancelPendingPreflop('flop-or-later-visible');
      else if (present && at - pendingPreflopHeroBoundary.armedAt >= PREFLOP_REDEAL_GRACE_MS) {
        const committed = maybeCommitPending(machine, 'preflop', at);
        if (committed) return committed;
      }

      if (pendingPreflopHeroBoundary) {
        diagnostics.lastReason = 'preflop-hero-boundary-awaiting-stable-dealer-move';
        return { newHand: false, reason: 'r14-preflop-redeal-awaiting-public-boundary' };
      }
    }

    const beforeHandId = machine.handId;
    const out = transactionObserveHero(fp, present, at) || { newHand: false, reason: null };

    if (out.newHand && machine.handId === beforeHandId && (pendingPreflopHeroBoundary || pendingBoardBoundary)) {
      diagnostics.lastReason = pendingBoardBoundary ? 'board-boundary-deferred' : 'preflop-hero-boundary-deferred';
      return { newHand: false, reason: 'r14-boundary-awaiting-dealer-proof' };
    }

    rememberStableBoundaryBaseline(machine, present);
    return out;
  };

  machine.observeBoardCount = (count, at = nowMs()) => {
    if (![0, 3, 4, 5].includes(count)) return { newHand: false, reason: null };

    if (count > 0) {
      if (pendingPreflopHeroBoundary) cancelPendingPreflop('physical-board-visible');
      if (pendingBoardBoundary) cancelPendingBoard('physical-board-returned');
    } else if (pendingBoardBoundary) {
      const committed = maybeCommitPending(machine, 'board', at);
      if (committed) return committed;
    }

    const beforeHandId = machine.handId;
    const out = transactionObserveBoardCount(count, at) || { newHand: false, reason: null };

    // state-transaction can report newHand=true even when this guard intercepted
    // machine.newHand and converted it into a pending dealer-proof boundary.
    if (out.newHand && machine.handId === beforeHandId) {
      if (pendingBoardBoundary && count === 0) {
        const committed = maybeCommitPending(machine, 'board', at);
        if (committed) return committed;
      }
      diagnostics.correctedBoardResults++;
      diagnostics.lastReason = pendingBoardBoundary
        ? 'board-boundary-awaiting-stable-dealer-move'
        : 'boundary-vetoed-generation-stable';
      return { newHand: false, reason: 'r14-hero-continuity-protected' };
    }
    return out;
  };

  machine.__prcHeroContinuityGuardR14 = true;
}

install(activeHandMachine);

if (typeof window !== 'undefined') {
  window.__prcHeroContinuityGuardR14 = diagnostics;
}

export { HERO_RECENT_MS, PREFLOP_REDEAL_GRACE_MS, DEALER_CONFIRM_HITS, shouldProtect };
