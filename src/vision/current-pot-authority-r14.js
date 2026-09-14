import { activeHandMachine } from '../core/state-machine.js';

const diagnostics = {
  enabled: true,
  localPromotions: 0,
  fastPromotions: 0,
  fullMirrors: 0,
  rejectedFastJumps: 0,
  deferredFastChanges: 0,
  lastSource: 'boot',
  lastPot: null,
};

if (typeof window !== 'undefined') window.__prcCurrentPotAuthorityR14 = diagnostics;

let fastCandidate = { handId: 0, pot: null, seenAt: 0, hits: 0 };

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

function tolerance(value, ratio = 0.02) {
  return Math.max(0.005, Math.abs(Number(value) || 0) * ratio);
}

function closeMoney(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance(b);
}

function arbiter() {
  return typeof window !== 'undefined' ? window.__prcDealArbiterR14 : null;
}

function resetFastCandidate(handId = activeHandMachine?.handId || 0) {
  fastCandidate = { handId: Number(handId) || 0, pot: null, seenAt: 0, hits: 0 };
}

function commitCanonical(value, source = 'current-pot-authority', at = nowMs()) {
  const machine = activeHandMachine;
  const deal = arbiter();
  const pot = normalizeAmount(value);
  if (!machine || machine.handId <= 0 || !deal || pot === null) return false;
  const result = deal.commitPot(pot, { generation: machine.handId, source, now: at });
  if (!result?.accepted) return false;
  diagnostics.lastSource = source;
  diagnostics.lastPot = pot;
  return true;
}

function fastCurrentPot() {
  if (typeof window === 'undefined') return null;
  const machine = activeHandMachine;
  const fast = window.__prcAIDecisionR14;
  if (!machine || !fast || Number(fast.handId) !== Number(machine.handId)) return null;

  const pot = normalizeAmount(fast.pot);
  if (pot === null || Number(fast.potConfidence) < 0.92 || Number(fast.confidence) < 0.90) return null;
  if (Number(fast.actionsConfidence) < 0.84) return null;

  const actions = Array.isArray(fast.actions) ? fast.actions : [];
  if (fast.heroToAct !== true && actions.length < 2) return null;

  const seenAt = Number(fast.lastSeenAt) || 0;
  const latency = Math.max(0, Number(fast.lastLatencyMs) || 0);
  const age = seenAt > 0 ? nowMs() - seenAt : Infinity;
  const freshness = Math.max(3200, Math.min(7200, latency * 2 + 1800));
  if (age > freshness) return null;

  return { pot, actions, fast, seenAt };
}

function plausibleFastIncrease(current, next, actions) {
  if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(next) || next <= 0) return false;
  if (next + tolerance(current) < current) return false;
  if (closeMoney(current, next)) return true;

  const priced = (actions || [])
    .map((action) => Number(action?.amount))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  const maxAction = priced.length ? Math.max(...priced) : 0;
  const ceiling = Math.max(current * 12, current + maxAction * 6, current + 0.06);
  return next <= ceiling + tolerance(ceiling, 0.01);
}

function fullStronglyAgrees(pot) {
  if (typeof window === 'undefined') return false;
  const machine = activeHandMachine;
  const full = window.__prcAIStateR14;
  if (!machine || !full || Number(full.handId) !== Number(machine.handId)) return false;
  if (Number(full.confidence) < 0.92 || Number(full.potConfidence) < 0.90) return false;
  const fullPot = normalizeAmount(full.pot);
  if (fullPot === null || !closeMoney(fullPot, pot)) return false;
  const seenAt = Number(full.lastSeenAt) || 0;
  const latency = Math.max(0, Number(full.lastLatencyMs) || 0);
  const age = seenAt > 0 ? nowMs() - seenAt : Infinity;
  return age <= Math.max(4500, Math.min(9000, latency * 2 + 2200));
}

function mirrorCanonicalIntoFull() {
  if (typeof window === 'undefined') return;
  const machine = activeHandMachine;
  const full = window.__prcAIStateR14;
  const canonical = normalizeAmount(machine?.state?.pot);
  if (!machine || !full || Number(full.handId) !== Number(machine.handId) || canonical === null) return;

  const fast = fastCurrentPot();
  const raw = normalizeAmount(full.pot);
  if (!fast || !closeMoney(fast.pot, canonical)) return;
  if (raw !== null && closeMoney(raw, canonical)) return;

  full.pot = canonical;
  full.potSource = 'canonical-current';
  diagnostics.fullMirrors++;
}

function installLocalAuthority() {
  const machine = activeHandMachine;
  if (!machine || machine.__prcCurrentPotAuthorityR14) return;
  const downstream = machine.setPot.bind(machine);

  machine.setPot = (value, handId, options = {}) => {
    const source = String(options?.source || 'local');
    if (source === 'local' && Number(handId) === Number(machine.handId)) {
      const accepted = commitCanonical(value, 'local-stable-pot', options?.now ?? nowMs());
      if (accepted) {
        diagnostics.localPromotions++;
        resetFastCandidate(machine.handId);
        mirrorCanonicalIntoFull();
      }
      return accepted;
    }
    return downstream(value, handId, options);
  };
  machine.__prcCurrentPotAuthorityR14 = true;
}

function observeFastCandidate(evidence) {
  const machine = activeHandMachine;
  if (!machine) return 0;
  const pot = evidence.pot;
  const stamp = Number(evidence.seenAt) || 0;
  if (fastCandidate.handId !== Number(machine.handId) || !closeMoney(fastCandidate.pot, pot)) {
    fastCandidate = { handId: Number(machine.handId), pot, seenAt: stamp, hits: 1 };
    return 1;
  }
  if (stamp > 0 && stamp !== fastCandidate.seenAt) {
    fastCandidate.seenAt = stamp;
    fastCandidate.hits++;
  }
  return fastCandidate.hits;
}

function promoteFastCurrentPot() {
  const machine = activeHandMachine;
  if (!machine || machine.handId <= 0) return;
  if (fastCandidate.handId !== Number(machine.handId)) resetFastCandidate(machine.handId);
  const evidence = fastCurrentPot();
  if (!evidence) return;

  const current = normalizeAmount(machine.state?.pot);
  if (current === null) return;
  if (closeMoney(current, evidence.pot)) {
    resetFastCandidate(machine.handId);
    mirrorCanonicalIntoFull();
    return;
  }

  if (!plausibleFastIncrease(current, evidence.pot, evidence.actions)) {
    diagnostics.rejectedFastJumps++;
    resetFastCandidate(machine.handId);
    return;
  }

  const hits = observeFastCandidate(evidence);
  const secondSourceAgrees = fullStronglyAgrees(evidence.pot);
  if (hits < 2 && !secondSourceAgrees) {
    diagnostics.deferredFastChanges++;
    return;
  }

  if (commitCanonical(evidence.pot, secondSourceAgrees ? 'ai-current-two-source' : 'ai-decision-current-2frames', nowMs())) {
    diagnostics.fastPromotions++;
    resetFastCandidate(machine.handId);
    mirrorCanonicalIntoFull();
  }
}

installLocalAuthority();
if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', () => resetFastCandidate(activeHandMachine?.handId || 0));
}
setInterval(() => {
  installLocalAuthority();
  promoteFastCurrentPot();
  mirrorCanonicalIntoFull();
}, 70);

export { fastCurrentPot, plausibleFastIncrease };
