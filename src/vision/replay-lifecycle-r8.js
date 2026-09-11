import { activeHandMachine } from '../core/state-machine.js';

function semanticKey(fp) {
  if (!Array.isArray(fp) || fp.length !== 2) return null;
  if (!fp.every((v) => v == null || typeof v === 'string')) return null;
  if (!fp.some(Boolean)) return null;
  return fp.map((v) => String(v || '?').toUpperCase()).join('');
}

function currentHeroKey(machine) {
  const hero = machine?.state?.hero;
  if (!Array.isArray(hero) || hero.length !== 2 || hero.some((c) => !c?.rank)) return null;
  return hero.map((c) => String(c.rank).toUpperCase()).join('');
}

function quarantine(machine) {
  if (!machine?.state) return;
  machine.state.hero = [];
  machine.state.board = [];
  machine.state.street = 'preflop';
  machine.state.reason = 'redeal-confirming-r8';
  machine.state.provisionalDecision = null;
  const heroEl = document.getElementById('heroCards');
  const boardEl = document.getElementById('boardCards');
  if (heroEl) heroEl.textContent = '—';
  if (boardEl) boardEl.textContent = '—';
}

function install(machine) {
  if (!machine || machine.__prcReplayLifecycleR8) return;
  const rawObserveHero = machine.observeHero.bind(machine);
  let gapArmed = false;
  let pendingKey = null;
  let pendingHits = 0;
  let quarantined = false;

  machine.observeHero = (fp, present, now = performance.now()) => {
    if (!present) {
      if (currentHeroKey(machine)) gapArmed = true;
      return rawObserveHero(fp, present, now);
    }

    const key = semanticKey(fp);
    const beforeKey = currentHeroKey(machine);
    const out = rawObserveHero(fp, present, now);

    if (out.newHand) {
      gapArmed = false; pendingKey = null; pendingHits = 0; quarantined = false;
      return out;
    }

    if (!key || !beforeKey || key === beforeKey) {
      if (key && beforeKey && key === beforeKey) {
        gapArmed = false; pendingKey = null; pendingHits = 0; quarantined = false;
      }
      return out;
    }

    // A physical gap followed by a stable different semantic pair is the most
    // reliable replay-only redeal signal available when the hand ends preflop.
    // Fail closed immediately: never keep showing the old hand while the new
    // deal is being confirmed.
    if (gapArmed && !quarantined) {
      quarantine(machine);
      quarantined = true;
    }

    if (pendingKey === key) pendingHits++;
    else { pendingKey = key; pendingHits = 1; }

    const required = gapArmed ? 2 : 5;
    if (pendingHits < required) return { ...out, reason: gapArmed ? 'r8-redeal-confirming' : out.reason };

    machine.newHand(gapArmed ? 'hero-redeal-r8' : 'hero-change-r8', now);
    machine.lastFp = fp;
    machine.pendingFp = null;
    machine.pendingHits = 0;
    machine.reappearArmed = false;
    machine.reappearHinted = false;
    gapArmed = false; pendingKey = null; pendingHits = 0; quarantined = false;
    return { newHand: true, reason: machine.state.reason };
  };

  machine.__prcReplayLifecycleR8 = true;
}

install(activeHandMachine);
