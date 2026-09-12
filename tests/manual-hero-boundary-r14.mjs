import assert from 'node:assert/strict';

const listeners = new Map();
globalThis.window = {
  __prcPublicLifecycleR14: {
    view: () => ({
      visualBoardCount: 0,
      visualBoardHits: 3,
      boardClearArmed: true,
      maxVisualBoardCount: 5,
    }),
  },
  addEventListener(type, fn) { listeners.set(type, fn); },
  dispatchEvent(event) { listeners.get(event.type)?.(event); },
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};
if (!globalThis.performance) globalThis.performance = { now: () => 1000 };

const { HandMachine } = await import('../src/core/state-machine.js');
const machine = new HandMachine();
machine.newHand('old-hand', 10);
machine.state.hero = [
  { rank: '8', suit: 'clubs', confidence: 1 },
  { rank: '2', suit: 'clubs', confidence: 1 },
];
machine.state.board = [
  { rank: 'J', suit: 'diamonds', confidence: 1 },
  { rank: 'T', suit: 'clubs', confidence: 1 },
  { rank: '7', suit: 'hearts', confidence: 1 },
  { rank: '4', suit: 'spades', confidence: 1 },
  { rank: '4', suit: 'hearts', confidence: 1 },
];
machine.state.street = 'river';
machine.state.pot = 0.67;

const mod = await import(`../src/vision/manual-hero-boundary-r14.js?test=${Date.now()}`);
assert.equal(mod.shouldRotateFromManualHero(machine), true, 'stable physical empty board plus stale logical river must be a redeal candidate');

const oldHandId = machine.handId;
listeners.get('prc:manual-state-applied')?.({ detail: { generation: oldHandId, hero: true } });
assert.equal(machine.handId, oldHandId + 1, 'manual Hero on a physically empty new table must rotate stale generation');
assert.equal(machine.state.street, 'preflop');
assert.deepEqual(machine.state.board, []);
assert.equal(machine.state.pot, null);
assert.deepEqual(machine.state.hero.map((c) => `${c.rank}${c.suit}`), ['8clubs','2clubs'], 'manual Hero must be rebound into the new generation');

window.__prcPublicLifecycleR14 = { view: () => ({ visualBoardCount: 3, visualBoardHits: 3, boardClearArmed: false, maxVisualBoardCount: 3 }) };
machine.state.board = [
  { rank: '2', suit: 'hearts' },
  { rank: '7', suit: 'diamonds' },
  { rank: 'T', suit: 'clubs' },
];
machine.state.street = 'flop';
assert.equal(mod.shouldRotateFromManualHero(machine), false, 'manual correction during a real flop must not rotate the hand');

console.log('MANUAL HERO BOUNDARY R14 passed');
