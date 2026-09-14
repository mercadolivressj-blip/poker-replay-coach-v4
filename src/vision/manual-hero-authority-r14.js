import { activeHandMachine } from '../core/state-machine.js';

const authority = {
  handId: 0,
  // Legacy name retained for compatibility: remote/full-frame AI never owns
  // Hero cards. R14 may accept a LOCAL reader only for an explicitly confirmed
  // replay source (uploaded file/image or the user-confirmed shared replay).
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

function replayAutoAllowed() {
  if (typeof window === 'undefined') return false;
  const replay = window.__prcReplayOnlyR14;
  const fileReplay = Boolean(
    replay?.fileReady === true
    && (replay?.sourceKind === 'video-file' || replay?.sourceKind === 'image-file')
  );
  const confirmedSharedReplay = Boolean(
    replay?.screenReplayReady === true
    && replay?.sourceKind === 'screen-replay'
  );
  return fileReplay || confirmedSharedReplay;
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
      // Automatic Hero ownership exists only inside the explicit replay modes.
      if (!authority.localReplayAuto || !replayAutoAllowed()) return false;

      // Manual correction is final for the current hand. Local vision may only
      // verify the same pair; it can never overwrite a manual correction.
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
    set(_value) {},
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
