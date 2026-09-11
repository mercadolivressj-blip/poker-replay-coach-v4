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
machine.observeBoardCount(3, 1100);
assert.equal(machine.state.hero.length, 2);
assert.equal(machine.state.board.length, 3);

// The board clearing is a real hand-transition hint, but does not rotate by
// itself. Combine it with a short Hero disappearance to arm the next deal.
life = machine.observeBoardCount(0, 1250);
assert.equal(life.newHand, false);
assert.equal(machine.transitionHintReason, 'board-cleared');
for (const now of [1300, 1350]) {
  life = machine.observeHero(null, false, now);
  assert.equal(life.newHand, false);
}
assert.equal(machine.reappearArmed, true);
assert.equal(machine.reappearHinted, true);

// The next hand is allowed to have the SAME ranks. First frame confirms the
// candidate, second frame opens the new hand.
life = machine.observeHero(['5', '5'], true, 1400);
assert.equal(life.newHand, false);
assert.equal(life.reason, 'hero-redeal-confirming');
life = machine.observeHero(['5', '5'], true, 1450);
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

// A long same-card detector dropout with NO board/pot hint remains the same hand.
for (const now of [1700, 1740, 1780, 1820, 1860, 1900, 1940]) machine.observeHero(null, false, now);
life = machine.observeHero(['5', '5'], true, 2000);
assert.equal(life.newHand, false);
assert.equal(life.reason, 'hero-same-reappeared');
assert.equal(machine.handId, 2);

console.log('REPLAY ROLLOVER V6 regressions passed');
