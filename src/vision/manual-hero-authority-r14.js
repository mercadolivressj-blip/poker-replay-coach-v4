import { activeHandMachine } from '../core/state-machine.js';

const authority = {
  handId: 0,
  // Legacy name retained for compatibility: remote/full-frame AI never owns
  // Hero cards. R14 may now also accept a LOCAL replay-file reader after strong
  // temporal consensus; manual correction always has priority over it.
  manualOnly: true,
  localReplayAuto: true,
  heroLocked: false,
  heroSource: null,
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

function completeHero(cards) {
  return Array.isArray(cards)
    && cards.length === 2
    && cards.every((card) => card?.rank && card?.suit);
}

function replayFileAutoAllowed() {
  if (typeof window === 'undefined') return false;
  const replay = window.__prcReplayOnlyR14;
  return Boolean(
    replay?.fileReady === true
    && (replay?.sourceKind === 'video-file' || replay?.sourceKind === 'image-file')
  );
}

function heroReady() {
  const cards = activeHandMachine?.state?.hero || [];
  return authority.heroLocked
    && authority.handId === activeHandMachine?.handId
    && completeHero(cards);
}

function reset(handId = activeHandMachine?.handId || 0) {
  authority.handId = Number(handId) || 0;
  authority.heroLocked = false;
  authority.heroSource = null;
  authority.lockedAt = 0;
}

function lockHero(source = 'manual') {
  const machine = activeHandMachine;
  if (!machine?.state || machine.handId <= 0 || !completeHero(machine.state.hero || [])) return false;
  authority.handId = machine.handId;
  authority.heroLocked = true;
  authority.heroSource = source === 'replay-auto' ? 'replay-auto' : 'manual';
  authority.lockedAt = now();
  syncManualOnlyState();
  return true;
}

function installMachineGuard() {
  const machine = activeHandMachine;
  if (!machine || machine.__prcManualHeroAuthorityGuardR14) return;

  const setHero = machine.setHero.bind(machine);
  machine.setHero = (cards, handId, options = {}) => {
    const source = String(options?.source || 'local');

    if (source === 'manual') {
      const accepted = setHero(cards, handId, options);
      if (accepted && completeHero(cards)) lockHero('manual');
      return accepted;
    }

    if (source === 'replay-auto') {
      // Never extend local visual Hero recognition to a shared/live screen.
      // Automatic Hero ownership exists only for an uploaded replay/image file.
      if (!authority.localReplayAuto || !replayFileAutoAllowed()) return false;

      // A manual correction is final for the current hand. The local reader may
      // verify the same pair but can never overwrite it.
      if (authority.heroLocked && Number(authority.handId) === Number(handId)) {
        if (authority.heroSource === 'manual') return sameCards(machine.state.hero || [], cards || []);
        if (sameCards(machine.state.hero || [], cards || [])) return true;
        return false;
      }

      const accepted = setHero(cards, handId, options);
      if (accepted && completeHero(cards)) lockHero('replay-auto');
      return accepted;
    }

    // Full-frame/fast AI and legacy visual lanes may observe physical presence
    // for lifecycle, but they do not own Hero identity in R14.
    return sameCards(machine.state.hero || [], cards || []);
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
      // Ignore remote AI Hero-card reads completely. Hero is either manually
      // entered or confirmed by the local replay-file pixel reader.
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
    // The full-frame endpoint owns public table context, never Hero cards.
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
    lockHero('manual');
  });

  window.addEventListener('prc:hero-auto-confirmed', (event) => {
    if (Number(event.detail?.generation) !== Number(activeHandMachine?.handId)) return;
    if (authority.heroSource !== 'manual') lockHero('replay-auto');
  });
}

setInterval(() => {
  installMachineGuard();
  installDecisionDiagnosticGuard();
  syncManualOnlyState();
}, 80);
