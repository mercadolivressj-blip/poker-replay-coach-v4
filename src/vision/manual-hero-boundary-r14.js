import { activeHandMachine } from '../core/state-machine.js';

function publicLifecycle() {
  const source = typeof window !== 'undefined' ? window.__prcPublicLifecycleR14 : null;
  return typeof source?.view === 'function' ? source.view() : source;
}

function shouldRotateFromManualHero(machine) {
  if (!machine?.state || machine.handId <= 0) return false;
  const board = Array.isArray(machine.state.board) ? machine.state.board : [];
  const staleLogicalPublicState = board.length > 0 || String(machine.state.street || 'preflop') !== 'preflop';
  if (!staleLogicalPublicState) return false;

  const life = publicLifecycle();
  if (!life) return false;
  const physicalEmpty = Number(life.visualBoardCount) === 0 && Number(life.visualBoardHits) >= 3;
  return Boolean(physicalEmpty && (life.boardClearArmed || Number(life.maxVisualBoardCount) > 0));
}

// R14 used to create a new generation immediately when the user finished
// entering Hero while a stale logical board happened to be visible. In a
// continuously playing replay that can occur during an ordinary street animation
// and was one of the paths that erased Hero and reopened the popup mid-hand.
//
// Manual/automatic Hero confirmation is now identity only. The central Hero
// continuity guard owns EVERY post-lock hand boundary and requires a stable
// dealer move before generation can rotate.
function observeManualHero(event) {
  if (!event?.detail?.hero) return;
  const machine = activeHandMachine;
  const candidate = shouldRotateFromManualHero(machine);
  if (typeof window !== 'undefined') {
    const diag = window.__prcManualHeroBoundaryR14;
    if (diag) {
      diag.observations++;
      diag.lastCandidate = candidate;
      diag.lastGeneration = machine?.handId || 0;
    }
  }
}

if (typeof window !== 'undefined') {
  window.__prcManualHeroBoundaryR14 = {
    enabled: true,
    observations: 0,
    lastCandidate: false,
    lastGeneration: 0,
    rule: 'hero-confirmation-never-creates-generation; stable-dealer-proof-owns-boundary',
  };
  window.addEventListener('prc:manual-state-applied', observeManualHero);
  window.addEventListener('prc:hero-auto-confirmed', observeManualHero);
}

export { shouldRotateFromManualHero };
