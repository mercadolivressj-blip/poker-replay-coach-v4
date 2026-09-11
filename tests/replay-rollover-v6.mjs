import assert from 'node:assert/strict';
import { HandMachine } from '../src/core/state-machine.js';

const c = (rank, suit) => ({ rank, suit, confidence: 0.94 });
const machine = new HandMachine();

// Hand 1 confirms normally.
let life = machine.observeHero(['5', '5'], true, 1000);
assert.equal(life.newHand, true);
assert.equal(machine.handId, 1);
assert.equal(machine.setHero([c('5', 'spades'), c('5', 'diamonds')], 1), true);
assert.equal(machine.setBoard([c('K', 'hearts'), c('A', 'spades'), c('K', 'diamonds')], 1), true);
assert.equal(machine.state.hero.length, 2);
assert.equal(machine.state.board.length, 3);

// Replay deals are quick. Four half-rate observations without Hero are enough
// to arm a redeal, but must not open a new hand until cards reappear stably.
for (const now of [1300, 1350, 1400, 1450]) {
  life = machine.observeHero(null, false, now);
  assert.equal(life.newHand, false);
}
assert.equal(machine.reappearArmed, true);

// The next hand is allowed to have the SAME ranks. First frame confirms the
// candidate, second frame opens the new hand.
life = machine.observeHero(['5', '5'], true, 1500);
assert.equal(life.newHand, false);
assert.equal(life.reason, 'hero-redeal-confirming');
life = machine.observeHero(['5', '5'], true, 1550);
assert.equal(life.newHand, true);
assert.equal(life.reason, 'hero-redealt');
assert.equal(machine.handId, 2);
assert.deepEqual(machine.state.hero, []);
assert.deepEqual(machine.state.board, []);

// Hand 2 must accept Hero and board immediately after the rollover. This is the
// real-world failure we saw: preflop 55 visible, then K-A-K flop, while UI stayed —.
assert.equal(machine.setHero([c('5', 'spades'), c('5', 'diamonds')], 2), true);
assert.equal(machine.setBoard([c('K', 'hearts'), c('A', 'spades'), c('K', 'diamonds')], 2), true);
assert.deepEqual(machine.state.hero.map((x) => [x.rank, x.suit]), [['5', 'spades'], ['5', 'diamonds']]);
assert.deepEqual(machine.state.board.map((x) => [x.rank, x.suit]), [['K', 'hearts'], ['A', 'spades'], ['K', 'diamonds']]);
assert.equal(machine.state.street, 'flop');

console.log('REPLAY ROLLOVER V6 regressions passed');
