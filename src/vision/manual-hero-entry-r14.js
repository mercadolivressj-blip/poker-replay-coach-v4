import { activeHandMachine } from '../core/state-machine.js';

let promptedHandId = 0;
let lastHeroAppliedHandId = 0;
let armedPromptHandId = 0;
let armedPromptReason = 'boot';

const CONFIRMED_GENERATION_REASONS = new Set([
  'first-cards',
  'r14-board-cleared-postflop',
  'r14-board-redeal-after-clear',
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

function confirmedGeneration(handId, reason) {
  if (handId <= 0) return false;
  if (handId === 1 && lastHeroAppliedHandId === 0) return true;

  const normalized = String(reason || '');
  if (!CONFIRMED_GENERATION_REASONS.has(normalized)) return false;

  if (normalized === 'r14-physical-hero-redeal') {
    const guard = typeof window !== 'undefined' ? window.__prcHeroContinuityGuardR14 : null;
    const guardReason = String(guard?.lastReason || '');
    return guardReason.includes('confirmed-dealer-moved')
      || guardReason.includes('confirmed-pot-reset')
      || Number(guard?.committedPreflopHeroBoundaries) > 0;
  }

  return true;
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

  // After the user has already entered a Hero once, never let the 220ms polling
  // loop reopen the modal just because some internal detector cleared authority.
  // A later hand must be explicitly armed by a confirmed public generation.
  if (lastHeroAppliedHandId > 0 && armedPromptHandId !== handId) return;

  // Even a confirmed old-hand boundary can happen before the new physical cards
  // are dealt. Wait until the fresh generation has actually seen Hero cards.
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

    // An unconfirmed internal generation is never allowed to steal focus by
    // opening the manual card editor. Keep the modal disarmed and let the
    // lifecycle/diagnostics resolve the boundary first.
    armedPromptReason = `blocked:${reason || 'unknown'}`;
  });

  window.addEventListener('prc:manual-state-applied', (event) => {
    if (!event.detail?.hero) return;
    const generation = Number(event.detail.generation) || Number(activeHandMachine?.handId) || 0;
    lastHeroAppliedHandId = generation;
    promptedHandId = generation;
    armedPromptHandId = 0;
    armedPromptReason = 'hero-applied';
  });

  window.__prcPromptManualHeroR14 = promptCurrentHand;
  window.__prcManualHeroEntryR14 = {
    get promptedHandId() { return promptedHandId; },
    get lastHeroAppliedHandId() { return lastHeroAppliedHandId; },
    get armedPromptHandId() { return armedPromptHandId; },
    get armedPromptReason() { return armedPromptReason; },
  };
}

setInterval(() => {
  markManualUi();
  promptCurrentHand();
}, 220);
