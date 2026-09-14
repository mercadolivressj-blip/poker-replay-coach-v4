import { activeHandMachine } from '../core/state-machine.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';

let promptedHandId = 0;
let lastHeroAppliedHandId = 0;
let lastHeroAppliedDealerSeat = null;
let armedPromptHandId = 0;
let armedPromptReason = 'boot';
let dealerCandidate = null;
let dealerCandidateHits = 0;

const CONFIRMED_GENERATION_REASONS = new Set([
  'first-cards',
  'r14-physical-hero-redeal',
]);

function heroReady() {
  const authority = typeof window !== 'undefined' ? window.__prcManualHeroAuthorityR14 : null;
  const cards = activeHandMachine?.state?.hero || [];
  return Boolean(
    authority?.heroLocked
    && authority.handId === activeHandMachine?.handId
    && cards.length === 2
    && cards.every((card) => card?.rank && card?.suit)
  );
}

function lifecycleView() {
  const source = typeof window !== 'undefined' ? window.__prcPublicLifecycleR14 : null;
  return typeof source?.view === 'function' ? source.view() : source;
}

function physicalHeroReadyForPrompt() {
  const life = lifecycleView();
  if (!life) return false;
  return life.seenHeroPresent === true && life.heroGapArmed !== true;
}

function currentDealerSeat() {
  const tableDealer = activeTableStateTracker?.latest?.dealerSeat;
  if (Number.isInteger(tableDealer)) return tableDealer;
  if (typeof window !== 'undefined') {
    const seats = window.__prcAIStateR14?.seats;
    const dealer = Array.isArray(seats) ? seats.find((seat) => seat?.dealer) : null;
    if (Number.isInteger(dealer?.seatIndex)) return dealer.seatIndex;
  }
  return null;
}

function confirmedGeneration(handId, reason) {
  if (handId <= 0) return false;
  if (handId === 1 && lastHeroAppliedHandId === 0) return true;

  const normalized = String(reason || '');
  if (!CONFIRMED_GENERATION_REASONS.has(normalized)) return false;

  if (normalized === 'r14-physical-hero-redeal') {
    const proof = typeof window !== 'undefined' ? window.__prcHeroRedealProofGuardR14 : null;
    const continuity = typeof window !== 'undefined' ? window.__prcHeroContinuityGuardR14 : null;
    const proofConfirmed = String(proof?.lastReason || '').includes('dealer-move-confirmed-2of2')
      || Number(proof?.confirmedDealerBoundaries) > 0;
    const continuityConfirmed = String(continuity?.lastReason || '').includes('confirmed-dealer-moved');
    return proofConfirmed || continuityConfirmed;
  }

  return true;
}

function maybeArmFromStableDealerMove() {
  const handId = Number(activeHandMachine?.handId) || 0;
  if (handId <= 0 || lastHeroAppliedHandId <= 0 || handId === lastHeroAppliedHandId || armedPromptHandId === handId) return false;
  if (!Number.isInteger(lastHeroAppliedDealerSeat)) return false;

  const dealer = currentDealerSeat();
  if (!Number.isInteger(dealer) || dealer === lastHeroAppliedDealerSeat) {
    dealerCandidate = null;
    dealerCandidateHits = 0;
    return false;
  }

  if (dealerCandidate === dealer) dealerCandidateHits++;
  else {
    dealerCandidate = dealer;
    dealerCandidateHits = 1;
  }
  if (dealerCandidateHits < 2) return false;

  armedPromptHandId = handId;
  armedPromptReason = 'stable-dealer-move-2of2';
  dealerCandidate = null;
  dealerCandidateHits = 0;
  if (promptedHandId >= handId) promptedHandId = handId - 1;
  return true;
}

function rememberDealerBaseline() {
  const handId = Number(activeHandMachine?.handId) || 0;
  if (!heroReady() || handId <= 0 || handId !== lastHeroAppliedHandId) return;
  const dealer = currentDealerSeat();
  if (Number.isInteger(dealer)) lastHeroAppliedDealerSeat = dealer;
}

function markManualUi() {
  const metric = document.querySelector('.metric-editable[data-manual-target="hero"]');
  if (!metric) return null;
  const label = metric.querySelector('span');
  if (label && !label.dataset.manualOnlyR14) {
    label.dataset.manualOnlyR14 = '1';
    const edit = label.querySelector('em');
    label.textContent = 'SUAS CARTAS · MANUAL ';
    if (edit) label.append(edit);
  }
  metric.title = 'Informe manualmente suas duas cartas nesta mão';
  metric.setAttribute('aria-label', 'Informar manualmente suas duas cartas');
  return metric;
}

function promptCurrentHand() {
  if (typeof document === 'undefined') return;
  const handId = Number(activeHandMachine?.handId) || 0;
  if (handId <= 0 || promptedHandId === handId || heroReady()) return;

  maybeArmFromStableDealerMove();

  // After Hero was entered once, no board-clear, pot glitch or internal
  // generation may reopen the modal. A later hand must be armed by a stable
  // public dealer move or an already dealer-confirmed physical redeal.
  if (lastHeroAppliedHandId > 0 && armedPromptHandId !== handId) return;
  if (!physicalHeroReadyForPrompt()) return;

  const metric = markManualUi();
  if (!metric) return;
  const panel = document.getElementById('manualPanel');
  if (panel && !panel.classList.contains('hidden')) return;
  promptedHandId = handId;
  metric.click();
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', (event) => {
    const handId = Number(event.detail?.generation) || Number(activeHandMachine?.handId) || 0;
    const reason = String(event.detail?.reason || '');

    if (confirmedGeneration(handId, reason)) {
      armedPromptHandId = handId;
      armedPromptReason = reason || 'confirmed-generation';
      if (promptedHandId >= handId) promptedHandId = handId - 1;
      setTimeout(promptCurrentHand, 80);
      return;
    }

    // Board-only or otherwise unproven generations never steal focus. Polling
    // may arm this hand later only after the dealer move is seen twice.
    armedPromptReason = `blocked:${reason || 'unknown'}`;
    dealerCandidate = null;
    dealerCandidateHits = 0;
  });

  window.addEventListener('prc:manual-state-applied', (event) => {
    if (!event.detail?.hero) return;
    const generation = Number(event.detail.generation) || Number(activeHandMachine?.handId) || 0;
    lastHeroAppliedHandId = generation;
    lastHeroAppliedDealerSeat = currentDealerSeat();
    promptedHandId = generation;
    armedPromptHandId = 0;
    armedPromptReason = 'hero-applied';
    dealerCandidate = null;
    dealerCandidateHits = 0;
  });

  window.__prcPromptManualHeroR14 = promptCurrentHand;
  window.__prcManualHeroEntryR14 = {
    get promptedHandId() { return promptedHandId; },
    get lastHeroAppliedHandId() { return lastHeroAppliedHandId; },
    get lastHeroAppliedDealerSeat() { return lastHeroAppliedDealerSeat; },
    get armedPromptHandId() { return armedPromptHandId; },
    get armedPromptReason() { return armedPromptReason; },
    get dealerCandidateHits() { return dealerCandidateHits; },
  };
}

setInterval(() => {
  markManualUi();
  rememberDealerBaseline();
  promptCurrentHand();
}, 220);
