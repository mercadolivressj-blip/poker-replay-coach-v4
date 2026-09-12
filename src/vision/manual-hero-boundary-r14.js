import { activeHandMachine } from '../core/state-machine.js';

function cloneHero(cards) {
  return (cards || []).map((card) => ({ ...card }));
}

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

function rebaseManualHeroIfNeeded(event) {
  if (!event?.detail?.hero || event.detail?.rebasedBoundary) return;
  const machine = activeHandMachine;
  if (!shouldRotateFromManualHero(machine)) return;

  const hero = cloneHero(machine.state.hero);
  if (hero.length !== 2 || !hero.every((card) => card?.rank && card?.suit)) return;

  const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  machine.newHand('r14-manual-hero-confirms-redeal', now);
  const accepted = machine.setHero(hero, machine.handId, { source: 'manual', now });
  if (!accepted) return;

  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('prc:manual-state-applied', {
      detail: {
        generation: machine.handId,
        hero: true,
        board: false,
        pot: false,
        rebasedBoundary: true,
      },
    }));
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:manual-state-applied', rebaseManualHeroIfNeeded);
  window.__prcManualHeroBoundaryR14 = {
    enabled: true,
    rule: 'manual-hero-plus-stable-empty-board-rotates-stale-public-state',
  };
}

export { shouldRotateFromManualHero };
