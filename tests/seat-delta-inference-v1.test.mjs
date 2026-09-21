import assert from 'node:assert/strict';
import { inferSeatAction, computeToCallFromCommitments } from '../src/core/seat-delta-inference.js';

// Fast fold: the turn ring can be missed, but disappearing cards while chips are
// still owed is sufficient evidence for FOLD.
assert.equal(
  inferSeatAction(
    {cardsPresent:true,commitment:0,turn:false},
    {cardsPresent:false,commitment:0,turn:false},
    {tableMaxBefore:.50},
  ).action,
  'FOLD',
);

assert.equal(inferSeatAction({cardsPresent:true,commitment:0,turn:true},{cardsPresent:true,commitment:0,turn:false},{tableMaxBefore:0}).action,'CHECK');
assert.equal(inferSeatAction({cardsPresent:true,commitment:.25,stack:50},{cardsPresent:true,commitment:1,stack:49.25},{tableMaxBefore:1}).action,'CALL');
assert.equal(inferSeatAction({cardsPresent:true,commitment:.25,stack:50},{cardsPresent:true,commitment:2,stack:48.25},{tableMaxBefore:1}).action,'RAISE');
assert.equal(inferSeatAction({cardsPresent:true,commitment:0,stack:50},{cardsPresent:true,commitment:.5,stack:49.5},{tableMaxBefore:0}).action,'BET');
assert.equal(inferSeatAction({cardsPresent:true,commitment:2,stack:5},{cardsPresent:true,commitment:7,stack:0},{tableMaxBefore:7}).action,'ALLIN');

// End-of-hand cleanup after a check must stay CHECK even if PokerStars clears
// the player's cards in the same observation window.
assert.equal(
  inferSeatAction(
    {cardsPresent:true,commitment:.50,turn:true},
    {cardsPresent:false,commitment:.50,turn:false},
    {tableMaxBefore:.50},
  ).action,
  'CHECK',
);

// Card disappearance with no pending bet and no observed turn transition is
// ambiguous cleanup/showdown evidence, not a fold.
assert.equal(
  inferSeatAction(
    {cardsPresent:true,commitment:.50,turn:false},
    {cardsPresent:false,commitment:.50,turn:false},
    {tableMaxBefore:.50},
  ),
  null,
);

// A player cannot CHECK while facing an unmatched bet. Missing money evidence in
// this state must stay unresolved so the downstream validator blocks the Brain.
assert.equal(
  inferSeatAction({cardsPresent:true,commitment:0,turn:true},{cardsPresent:true,commitment:0,turn:false},{tableMaxBefore:.5}),
  null,
);
assert.equal(
  inferSeatAction({cardsPresent:true,commitment:.5,turn:true},{cardsPresent:true,commitment:.5,turn:false},{tableMaxBefore:.5}).action,
  'CHECK',
);

{
  const r=computeToCallFromCommitments({
    hero:{cardsPresent:true,commitment:.50},
    lb:{cardsPresent:true,commitment:1.75},
    top:{cardsPresent:true,commitment:1.75},
    rt:{cardsPresent:false,folded:true,commitment:.50},
  });
  assert.deepEqual(r,{value:1.25,source:'commitment-delta',heroCommitment:.5,tableMax:1.75});
}
{
  const r=computeToCallFromCommitments({hero:{cardsPresent:true,commitment:2},lb:{cardsPresent:true,commitment:2}});
  assert.equal(r.value,0);
  assert.equal(r.source,'commitment-delta');
}
assert.equal(computeToCallFromCommitments({hero:{cardsPresent:true}},'hero').value,null);

console.log('seat-delta-inference-v1 ok');
