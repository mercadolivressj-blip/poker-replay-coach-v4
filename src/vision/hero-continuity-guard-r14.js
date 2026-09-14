import { activeHandMachine } from '../core/state-machine.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';

const diagnostics = {
  enabled: true,
  suppressedGenerationChanges: 0,
  correctedBoardResults: 0,
  deferredPreflopHeroBoundaries: 0,
  cancelledPreflopHeroBoundaries: 0,
  committedPreflopHeroBoundaries: 0,
  confirmedPreflopByDealer: 0,
  confirmedPreflopByPotReset: 0,
  preflopBoundaryPending: false,
  lastBoundaryEvidence: null,
  lastReason: 'boot',
};

const HERO_RECENT_MS = 1000;
const PREFLOP_REDEAL_GRACE_MS = 250;
const PREFLOP_HERO_REDEAL_REASON = 'r14-physical-hero-redeal';
const BOARD_BOUNDARY_REASONS = new Set([
  'r14-board-cleared-postflop',
  'r14-board-redeal-after-clear',
]);

let pendingPreflopHeroBoundary = null;
let committingPendingPreflopBoundary = false;
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

function postflopAlive(machine) {
  return Array.isArray(machine?.state?.board) && machine.state.board.length >= 3;
}

function publicLifecycleView() {
  const life = typeof window !== 'undefined' ? window.__prcPublicLifecycleR14 : null;
  return typeof life?.view === 'function' ? life.view() : life;
}

function anyPublicBoardVisible(machine) {
  const logical = Array.isArray(machine?.state?.board) ? machine.state.board.length : 0;
  if (logical > 0) return true;

  const life = publicLifecycleView();
  if (Number(life?.visualBoardCount) > 0) return true;

  if (typeof window !== 'undefined') {
    const fast = window.__prcAIDecisionR14;
    const full = window.__prcAIStateR14;
    if (Array.isArray(fast?.board) && fast.board.length > 0) return true;
    if (Array.isArray(full?.board) && full.board.length > 0) return true;
  }

  return false;
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
  if (!present || pendingPreflopHeroBoundary || anyPublicBoardVisible(machine)) return;
  const life = publicLifecycleView();
  if (life?.heroGapArmed) return;

  const dealer = currentDealerSeat();
  if (Number.isInteger(dealer)) lastStableDealerSeat = dealer;
  const pot = stablePublicPot(machine);
  if (Number.isFinite(pot) && pot > 0) lastStablePublicPot = pot;
}

function redealEvidence(machine, pending) {
  const dealer = currentDealerSeat();
  const pot = stablePublicPot(machine);
  const baselineDealer = Number.isInteger(pending?.baselineDealerSeat) ? pending.baselineDealerSeat : null;
  const baselinePot = Number.isFinite(pending?.baselinePot) ? pending.baselinePot : null;

  const dealerChanged = baselineDealer !== null && Number.isInteger(dealer) && dealer !== baselineDealer;
  const potReset = Number.isFinite(baselinePot)
    && baselinePot > 0
    && Number.isFinite(pot)
    && pot > 0
    && pot <= baselinePot * 0.72
    && baselinePot - pot >= Math.max(0.01, baselinePot * 0.20);

  return {
    confirmed: dealerChanged || potReset,
    dealerChanged,
    potReset,
    baselineDealer,
    dealer,
    baselinePot,
    pot,
  };
}

function shouldProtect(machine, reason, at) {
  return BOARD_BOUNDARY_REASONS.has(String(reason || ''))
    && postflopAlive(machine)
    && heroComplete(machine)
    && heroRecentlyPhysical(machine, at);
}

function shouldDeferPreflopHeroBoundary(machine, reason) {
  return String(reason || '') === PREFLOP_HERO_REDEAL_REASON
    && !postflopAlive(machine)
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

function install(machine) {
  if (!machine || machine.__prcHeroContinuityGuardR14) return;

  const transactionNewHand = machine.newHand.bind(machine);
  const transactionObserveHero = machine.observeHero.bind(machine);
  const transactionObserveBoardCount = machine.observeBoardCount.bind(machine);

  machine.newHand = (reason, at = nowMs()) => {
    if (shouldProtect(machine, reason, at)) {
      diagnostics.suppressedGenerationChanges++;
      diagnostics.lastReason = `protected:${reason}`;
      return false;
    }

    if (!committingPendingPreflopBoundary && shouldDeferPreflopHeroBoundary(machine, reason)) {
      pendingPreflopHeroBoundary = {
        handId: machine.handId,
        reason: String(reason),
        armedAt: at,
        baselineDealerSeat: Number.isInteger(lastStableDealerSeat) ? lastStableDealerSeat : currentDealerSeat(),
        baselinePot: Number.isFinite(lastStablePublicPot) ? lastStablePublicPot : stablePublicPot(machine),
      };
      diagnostics.preflopBoundaryPending = true;
      diagnostics.deferredPreflopHeroBoundaries++;
      diagnostics.lastBoundaryEvidence = null;
      diagnostics.lastReason = 'preflop-hero-boundary-pending-public-evidence';
      return false;
    }

    pendingPreflopHeroBoundary = null;
    diagnostics.preflopBoundaryPending = false;
    diagnostics.lastReason = `allowed:${reason || 'unknown'}`;
    return transactionNewHand(reason, at);
  };

  machine.observeHero = (fp, present, at = nowMs()) => {
    if (pendingPreflopHeroBoundary && pendingPreflopHeroBoundary.handId !== machine.handId) {
      pendingPreflopHeroBoundary = null;
      diagnostics.preflopBoundaryPending = false;
    }

    if (pendingPreflopHeroBoundary && anyPublicBoardVisible(machine)) {
      cancelPendingPreflop('flop-or-later-visible');
    }

    if (pendingPreflopHeroBoundary) {
      if (present && at - pendingPreflopHeroBoundary.armedAt >= PREFLOP_REDEAL_GRACE_MS) {
        const evidence = redealEvidence(machine, pendingPreflopHeroBoundary);
        diagnostics.lastBoundaryEvidence = evidence;
        if (evidence.confirmed && !anyPublicBoardVisible(machine)) {
          const pending = pendingPreflopHeroBoundary;
          pendingPreflopHeroBoundary = null;
          diagnostics.preflopBoundaryPending = false;
          const before = machine.handId;
          committingPendingPreflopBoundary = true;
          try {
            machine.newHand(pending.reason, at);
          } finally {
            committingPendingPreflopBoundary = false;
          }
          if (machine.handId !== before) {
            diagnostics.committedPreflopHeroBoundaries++;
            if (evidence.dealerChanged) diagnostics.confirmedPreflopByDealer++;
            if (evidence.potReset) diagnostics.confirmedPreflopByPotReset++;
            diagnostics.lastReason = evidence.dealerChanged
              ? 'preflop-hero-boundary-confirmed-dealer-moved'
              : 'preflop-hero-boundary-confirmed-pot-reset';
            lastStableDealerSeat = evidence.dealer;
            lastStablePublicPot = evidence.pot;
            return { newHand: true, reason: pending.reason };
          }
        }
      }

      // Never let physical Hero disappearance/reappearance alone erase a manual
      // Hero. Hold the generation until a public redeal signal arrives, or until
      // a flop/turn/river proves this was only an in-hand animation/fold event.
      diagnostics.lastReason = 'preflop-hero-boundary-awaiting-public-evidence';
      return { newHand: false, reason: 'r14-preflop-redeal-awaiting-public-boundary' };
    }

    const beforeHandId = machine.handId;
    const out = transactionObserveHero(fp, present, at) || { newHand: false, reason: null };

    // state-transaction can report newHand=true even when this guard vetoed the
    // immediate preflop redeal. Normalize the result and keep the old manual Hero
    // alive while we wait for a public redeal signal.
    if (out.newHand && machine.handId === beforeHandId && pendingPreflopHeroBoundary) {
      diagnostics.lastReason = 'preflop-hero-boundary-deferred';
      diagnostics.preflopBoundaryPending = true;
      return { newHand: false, reason: 'r14-preflop-redeal-awaiting-public-boundary' };
    }

    rememberStableBoundaryBaseline(machine, present);
    return out;
  };

  machine.observeBoardCount = (count, at = nowMs()) => {
    if (count > 0 && pendingPreflopHeroBoundary) {
      cancelPendingPreflop('physical-board-visible');
    }

    const beforeHandId = machine.handId;
    const out = transactionObserveBoardCount(count, at) || { newHand: false, reason: null };

    // state-transaction may report newHand=true after calling machine.newHand.
    // If this guard vetoed that generation change because physical Hero is still
    // present, normalize the lifecycle result too so main.js does not reset its
    // lanes for a hand that never actually changed.
    if (out.newHand && machine.handId === beforeHandId) {
      diagnostics.correctedBoardResults++;
      diagnostics.lastReason = 'board-boundary-vetoed-hero-still-visible';
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

export { HERO_RECENT_MS, PREFLOP_REDEAL_GRACE_MS, shouldProtect };
