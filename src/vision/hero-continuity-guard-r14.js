import { activeHandMachine } from '../core/state-machine.js';

const diagnostics = {
  enabled: true,
  suppressedGenerationChanges: 0,
  correctedBoardResults: 0,
  deferredPreflopHeroBoundaries: 0,
  cancelledPreflopHeroBoundaries: 0,
  committedPreflopHeroBoundaries: 0,
  lastReason: 'boot',
};

const HERO_RECENT_MS = 1000;
const PREFLOP_REDEAL_GRACE_MS = 1000;
const PREFLOP_HERO_REDEAL_REASON = 'r14-physical-hero-redeal';
const BOARD_BOUNDARY_REASONS = new Set([
  'r14-board-cleared-postflop',
  'r14-board-redeal-after-clear',
]);

let pendingPreflopHeroBoundary = null;
let committingPendingPreflopBoundary = false;

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
      };
      diagnostics.deferredPreflopHeroBoundaries++;
      diagnostics.lastReason = 'preflop-hero-boundary-pending-board-check';
      return false;
    }

    pendingPreflopHeroBoundary = null;
    diagnostics.lastReason = `allowed:${reason || 'unknown'}`;
    return transactionNewHand(reason, at);
  };

  machine.observeHero = (fp, present, at = nowMs()) => {
    if (pendingPreflopHeroBoundary && pendingPreflopHeroBoundary.handId !== machine.handId) {
      pendingPreflopHeroBoundary = null;
    }

    if (pendingPreflopHeroBoundary && anyPublicBoardVisible(machine)) {
      cancelPendingPreflop('flop-or-later-visible');
    }

    if (pendingPreflopHeroBoundary
      && present
      && at - pendingPreflopHeroBoundary.armedAt >= PREFLOP_REDEAL_GRACE_MS
      && !anyPublicBoardVisible(machine)) {
      const pending = pendingPreflopHeroBoundary;
      pendingPreflopHeroBoundary = null;
      const before = machine.handId;
      committingPendingPreflopBoundary = true;
      try {
        machine.newHand(pending.reason, at);
      } finally {
        committingPendingPreflopBoundary = false;
      }
      if (machine.handId !== before) {
        diagnostics.committedPreflopHeroBoundaries++;
        diagnostics.lastReason = 'preflop-hero-boundary-committed-after-grace';
        return { newHand: true, reason: pending.reason };
      }
    }

    const beforeHandId = machine.handId;
    const out = transactionObserveHero(fp, present, at) || { newHand: false, reason: null };

    // state-transaction can report newHand=true even when this guard vetoed the
    // immediate preflop redeal. Normalize the result and keep the old manual Hero
    // alive while we wait briefly to see whether a flop appears.
    if (out.newHand && machine.handId === beforeHandId && pendingPreflopHeroBoundary) {
      diagnostics.lastReason = 'preflop-hero-boundary-deferred';
      return { newHand: false, reason: 'r14-preflop-redeal-pending-board-check' };
    }

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
