import assert from 'node:assert/strict';

globalThis.window = {
  __prcManualHeroAuthorityR14: {
    manualOnly: true,
    heroLocked: true,
    handId: 7,
  },
  addEventListener() {},
};

const { decisionEvidence } = await import('../src/vision/manual-hero-fast-trust-r14.js');

const hero = [
  { rank: 'A', suit: 'spades' },
  { rank: 'T', suit: 'hearts' },
];
const board = [
  { rank: 'K', suit: 'clubs' },
  { rank: '7', suit: 'diamonds' },
  { rank: '2', suit: 'spades' },
];
const machine = {
  handId: 7,
  state: { hero, board, pot: 0.18, street: 'flop' },
};
const fast = {
  handId: 7,
  hero: [],
  heroConfidence: 0,
  board: board.map((card) => ({ ...card })),
  pot: 0.18,
  heroToAct: true,
  actions: [{ type: 'fold', amount: null }, { type: 'call', amount: 0.06 }, { type: 'raise', amount: 0.18 }],
  actionsConfidence: 0.94,
  rawStableFrames: 2,
  confidence: 0.95,
  boardConfidence: 0.96,
  potConfidence: 0.96,
  lastSeenAt: 1000,
  lastLatencyMs: 2000,
};

const originalPerformance = globalThis.performance;
globalThis.performance = { now: () => 2500 };

assert.equal(decisionEvidence(machine, fast).trusted, true, 'manual Hero must satisfy fast trust even though AI hero=[] / heroConfidence=0');

window.__prcManualHeroAuthorityR14.heroLocked = false;
assert.equal(decisionEvidence(machine, fast).trusted, false, 'strategy cannot trust the fast lane before manual Hero is locked');
window.__prcManualHeroAuthorityR14.heroLocked = true;

const staleBoard = { ...fast, board: [{ rank: 'Q', suit: 'clubs' }, ...board.slice(1)] };
assert.equal(decisionEvidence(machine, staleBoard).trusted, false, 'stale/wrong board must block decision trust');

const oneFrame = { ...fast, rawStableFrames: 1 };
assert.equal(decisionEvidence(machine, oneFrame).trusted, false, '1/2 fast reading must never unlock strategy');

globalThis.performance = originalPerformance;
console.log('MANUAL HERO FAST TRUST R14 passed');
