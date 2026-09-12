import { activeHandMachine } from '../core/state-machine.js';

const authority = {
  handId: 0,
  manualOnly: true,
  heroLocked: false,
  lockedAt: 0,
};

if (typeof window !== 'undefined') window.__prcManualHeroAuthorityR14 = authority;

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function cardId(card) {
  return card?.rank && card?.suit ? `${String(card.rank).toUpperCase()}:${String(card.suit)}` : '?';
}

function sameCards(a, b) {
  return Array.isArray(a)
    && Array.isArray(b)
    && a.length === b.length
    && a.every((card, index) => cardId(card) === cardId(b[index]));
}

function heroReady() {
  const cards = activeHandMachine?.state?.hero || [];
  return authority.heroLocked
    && authority.handId === activeHandMachine?.handId
    && cards.length === 2
    && cards.every((card) => card?.rank && card?.suit);
}

function reset(handId = activeHandMachine?.handId || 0) {
  authority.handId = Number(handId) || 0;
  authority.heroLocked = false;
  authority.lockedAt = 0;
}

function lockHero() {
  const machine = activeHandMachine;
  if (!machine?.state || machine.handId <= 0) return;
  authority.handId = machine.handId;
  authority.heroLocked = true;
  authority.lockedAt = now();
  syncManualOnlyState();
}

function installMachineGuard() {
  const machine = activeHandMachine;
  if (!machine || machine.__prcManualHeroAuthorityGuardR14) return;

  const setHero = machine.setHero.bind(machine);
  machine.setHero = (cards, handId, options = {}) => {
    const source = String(options?.source || 'local');
    if (source !== 'manual') {
      // R14 manual-only Hero lane: visual/AI readers may still detect physical
      // card presence for hand lifecycle, but they never own Hero ranks/suits.
      return sameCards(machine.state.hero || [], cards || []);
    }
    return setHero(cards, handId, options);
  };

  machine.__prcManualHeroAuthorityGuardR14 = true;
}

function installDecisionDiagnosticGuard() {
  if (typeof window === 'undefined') return;
  const d = window.__prcAIDecisionR14;
  if (!d || d.__prcManualHeroAccessorR14) return;

  Object.defineProperty(d, 'hero', {
    configurable: true,
    enumerable: true,
    get() {
      return (activeHandMachine?.state?.hero || []).map((card) => ({ ...card }));
    },
    set(_value) {
      // Ignore AI Hero-card reads completely. The decision lane may keep reading
      // pot/actions/aggressor while Hero cards remain manual-only.
    },
  });

  Object.defineProperty(d, 'heroConfidence', {
    configurable: true,
    enumerable: true,
    get() { return heroReady() ? 1 : 0; },
    set(_value) {},
  });

  d.__prcManualHeroAccessorR14 = true;
}

function syncManualOnlyState() {
  const machine = activeHandMachine;
  if (!machine?.state) return;
  const ready = heroReady();
  const hero = ready ? (machine.state.hero || []).map((card) => ({ ...card })) : [];

  const full = typeof window !== 'undefined' ? window.__prcAIStateR14 : null;
  if (full) {
    full.manual ||= { hero: false, board: false, pot: false };
    // Always true: full-frame owns table context, never Hero cards.
    full.manual.hero = true;
    full.hero = hero.map((card) => ({ ...card }));
    full.heroConfidence = ready ? 1 : 0;
  }
}

installMachineGuard();
reset(activeHandMachine?.handId || 0);

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', (event) => {
    reset(Number(event.detail?.generation) || activeHandMachine?.handId || 0);
    syncManualOnlyState();
  });

  window.addEventListener('prc:manual-state-applied', (event) => {
    if (!event.detail?.hero) return;
    if (Number(event.detail.generation) !== activeHandMachine?.handId) return;
    lockHero();
  });
}

setInterval(() => {
  installMachineGuard();
  installDecisionDiagnosticGuard();
  syncManualOnlyState();
}, 80);
