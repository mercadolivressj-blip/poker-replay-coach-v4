import assert from 'node:assert/strict';
import { DealSnapshotArbiter } from '../src/core/deal-snapshot-arbiter-r14.js';

const machine = {
  handId: 14,
  state: { hero: [], board: [], street: 'preflop', pot: null },
};
const arbiter = new DealSnapshotArbiter(machine, { manualWindowMs: 5000 });

const hero73 = [
  { rank: '7', suit: 'spades', confidence: 0.92 },
  { rank: '3', suit: 'clubs', confidence: 0.91 },
];
assert.equal(arbiter.commitHero(hero73, { generation: 14, now: 1000 }).accepted, true);

// Exact real-replay regression: once 7s 3c is committed in generation 14,
// contradictory same-generation reads cannot mutate slot 0 to 3 or 2.
assert.equal(arbiter.commitHero([{ rank: '3' }, { rank: '3' }], { generation: 14, now: 1100 }).accepted, false);
assert.equal(machine.state.hero[0].rank, '7');
assert.equal(arbiter.commitHero([{ rank: '2' }, { rank: '3' }], { generation: 14, now: 1200 }).accepted, false);
assert.equal(machine.state.hero[0].rank, '7');
assert.equal(arbiter.view().hero[0].rank, '7');

// Board slots are generation locked too.
const oldRiver = [
  { rank: 'A', suit: 'hearts' },
  { rank: '6', suit: 'hearts' },
  { rank: '5', suit: 'hearts' },
  { rank: '4', suit: 'hearts' },
  { rank: '3', suit: 'spades' },
];
assert.equal(arbiter.commitBoard(oldRiver, { generation: 14, now: 1300 }).accepted, true);
const newFlop = [{ rank: '2' }, { rank: '3' }, { rank: 'T' }];
assert.equal(arbiter.commitBoard(newFlop, { generation: 14, now: 1400 }).accepted, false);
assert.equal(machine.state.board.length, 5);

// Manual recalibration is the only explicit same-generation escape hatch. It
// does not advance handId/generation; it grants one controlled rebind per lane.
const token = arbiter.beginManualRecalibration(1500);
assert.equal(token.generation, 14);
assert.equal(machine.handId, 14);
assert.equal(arbiter.commitHero([{ rank: '2', suit: 'hearts' }, { rank: '3', suit: 'clubs' }], {
  generation: 14,
  rebindToken: token,
  now: 1600,
}).accepted, true);
assert.equal(machine.state.hero[0].rank, '2');
assert.equal(arbiter.commitBoard(newFlop, {
  generation: 14,
  rebindToken: token,
  now: 1700,
}).accepted, true);
assert.deepEqual(machine.state.board.map((c) => c.rank), ['2', '3', 'T']);
assert.equal(machine.state.street, 'flop');
assert.equal(machine.handId, 14);

// The same token cannot be reused to mutate Hero twice.
assert.equal(arbiter.commitHero([{ rank: 'A' }, { rank: 'A' }], {
  generation: 14,
  rebindToken: token,
  now: 1800,
}).accepted, false);
assert.equal(machine.state.hero[0].rank, '2');

// A real generation change atomically drops the previous snapshot locks.
machine.handId = 15;
machine.state = { hero: [], board: [], street: 'preflop', pot: null };
assert.equal(arbiter.commitHero([{ rank: 'Q' }, { rank: 'J' }], { generation: 15, now: 2000 }).accepted, true);
assert.equal(arbiter.view().generation, 15);
assert.deepEqual(machine.state.hero.map((c) => c.rank), ['Q', 'J']);
assert.deepEqual(machine.state.board, []);

console.log('DEAL SNAPSHOT LOCK R14 passed');
