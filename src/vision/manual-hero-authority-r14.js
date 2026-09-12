import { activeHandMachine } from '../core/state-machine.js';

const authority = {
  handId: 0,
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

  const full = typeof window !== 'undefined' ? window.__prcAIStateR14 : null;
  if (full) {
    full.manual ||= { hero: false, board: false, pot: false };
    full.manual.hero = true;
    full.hero = (machine.state.hero || []).map((card) => ({ ...card }));
    full.heroConfidence = 1;
  }

  const fast = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;
  if (fast) {
    fast.hero = (machine.state.hero || []).map((card) => ({ ...card }));
    fast.heroConfidence = 1;
  }
}

function installMachineGuard() {
  const machine = activeHandMachine;
  if (!machine || machine.__prcManualHeroAuthorityGuardR14) return;

  const setHero = machine.setHero.bind(machine);
  machine.setHero = (cards, handId, options = {}) => {
    const source = String(options?.source || 'local');
    const locked = authority.heroLocked && authority.handId === handId && handId === machine.handId;
    if (locked && source !== 'manual') {
      // Idempotent reads are accepted so downstream confidence can converge,
      // but no sensor/AI is allowed to replace the user's correction.
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

  let storedHero = Array.isArray(d.hero) ? d.hero : [];
  Object.defineProperty(d, 'hero', {
    configurable: true,
    enumerable: true,
    get() {
      if (authority.heroLocked && authority.handId === activeHandMachine?.handId) {
        return (activeHandMachine?.state?.hero || []).map((card) => ({ ...card }));
      }
      return storedHero;
    },
    set(value) {
      if (authority.heroLocked && authority.handId === activeHandMachine?.handId) {
        storedHero = (activeHandMachine?.state?.hero || []).map((card) => ({ ...card }));
        return;
      }
      storedHero = Array.isArray(value) ? value : [];
    },
  });

  d.__prcManualHeroAccessorR14 = true;
}

function syncLockedHero() {
  if (!authority.heroLocked || authority.handId !== activeHandMachine?.handId) return;
  const hero = (activeHandMachine?.state?.hero || []).map((card) => ({ ...card }));

  const full = typeof window !== 'undefined' ? window.__prcAIStateR14 : null;
  if (full) {
    full.manual ||= { hero: false, board: false, pot: false };
    full.manual.hero = true;
    full.hero = hero.map((card) => ({ ...card }));
    full.heroConfidence = 1;
  }

  const fast = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;
  if (fast) {
    fast.heroConfidence = 1;
  }
}

installMachineGuard();
installDecisionDiagnosticGuard();
reset(activeHandMachine?.handId || 0);

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', (event) => {
    reset(Number(event.detail?.generation) || activeHandMachine?.handId || 0);
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
  syncLockedHero();
}, 120);
