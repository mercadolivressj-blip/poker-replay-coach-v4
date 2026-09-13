import { activeHandMachine } from '../core/state-machine.js';

const diagnostics = {
  enabled: true,
  suppressedGenerationChanges: 0,
  correctedBoardResults: 0,
  lastReason: 'boot',
};

const HERO_RECENT_MS = 1000;
const BOARD_BOUNDARY_REASONS = new Set([
  'r14-board-cleared-postflop',
  'r14-board-redeal-after-clear',
]);

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

function shouldProtect(machine, reason, at) {
  return BOARD_BOUNDARY_REASONS.has(String(reason || ''))
    && postflopAlive(machine)
    && heroComplete(machine)
    && heroRecentlyPhysical(machine, at);
}

function install(machine) {
  if (!machine || machine.__prcHeroContinuityGuardR14) return;

  const transactionNewHand = machine.newHand.bind(machine);
  const transactionObserveBoardCount = machine.observeBoardCount.bind(machine);

  machine.newHand = (reason, at = nowMs()) => {
    if (shouldProtect(machine, reason, at)) {
      diagnostics.suppressedGenerationChanges++;
      diagnostics.lastReason = `protected:${reason}`;
      return false;
    }
    diagnostics.lastReason = `allowed:${reason || 'unknown'}`;
    return transactionNewHand(reason, at);
  };

  machine.observeBoardCount = (count, at = nowMs()) => {
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

export { HERO_RECENT_MS, shouldProtect };
