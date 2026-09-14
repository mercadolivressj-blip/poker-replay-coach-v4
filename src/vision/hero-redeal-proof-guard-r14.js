import { activeHandMachine } from '../core/state-machine.js';

const diagnostics = {
  enabled: true,
  blockedPotOnlyBoundaries: 0,
  dealerCandidates: 0,
  confirmedDealerBoundaries: 0,
  lastReason: 'boot',
};

let candidateKey = '';
let candidateHits = 0;

function install(machine) {
  if (!machine || machine.__prcHeroRedealProofGuardR14) return;

  const upstreamNewHand = machine.newHand.bind(machine);
  machine.newHand = (reason, at) => {
    if (String(reason || '') !== 'r14-physical-hero-redeal') {
      candidateKey = '';
      candidateHits = 0;
      return upstreamNewHand(reason, at);
    }

    const guard = typeof window !== 'undefined' ? window.__prcHeroContinuityGuardR14 : null;
    const evidence = guard?.lastBoundaryEvidence || null;
    const dealerChanged = evidence?.dealerChanged === true;
    const dealer = Number.isInteger(evidence?.dealer) ? evidence.dealer : null;

    // Pot OCR can legitimately lag by a few seconds and then appear to fall.
    // It must never erase a manually entered Hero by itself. A preflop-only new
    // hand is confirmed only by a stable dealer/button move.
    if (!dealerChanged || dealer === null) {
      diagnostics.blockedPotOnlyBoundaries++;
      diagnostics.lastReason = 'blocked-preflop-redeal-without-dealer-move';
      candidateKey = '';
      candidateHits = 0;
      return false;
    }

    const key = `${machine.handId}:${dealer}`;
    if (key === candidateKey) candidateHits++;
    else {
      candidateKey = key;
      candidateHits = 1;
    }
    diagnostics.dealerCandidates = candidateHits;

    if (candidateHits < 2) {
      diagnostics.lastReason = 'dealer-move-confirming-1of2';
      return false;
    }

    candidateKey = '';
    candidateHits = 0;
    diagnostics.confirmedDealerBoundaries++;
    diagnostics.lastReason = 'dealer-move-confirmed-2of2';
    return upstreamNewHand(reason, at);
  };

  machine.__prcHeroRedealProofGuardR14 = true;
}

install(activeHandMachine);

if (typeof window !== 'undefined') {
  window.__prcHeroRedealProofGuardR14 = diagnostics;
}
