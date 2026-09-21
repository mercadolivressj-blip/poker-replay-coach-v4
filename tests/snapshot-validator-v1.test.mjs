import assert from 'node:assert/strict';
import { validatePokerSnapshot, gateBrainInput } from '../src/core/snapshot-validator.js';

const good = {
  heroCards:['2s','2c'],
  board:['As','7d','9s','4d','Ah'],
  heroButtons:['CHECK','BET'],
  heroPosition:'BB',
  positionSource:'dealer-plus-occupied-seats-only',
  pot:2.14,
  toCall:0,
  heroStack:56.85,
  actionComplete:true,
  actionHistory:[{seat:'rb',action:'CHECK'}],
};

assert.equal(validatePokerSnapshot(good).ok, true);
let called = 0;
const gated = gateBrainInput(good, () => { called++; return {action:'CHECK'}; });
assert.equal(gated.decided, true);
assert.equal(called, 1);

const bad = {...good, board:['As','7d','9s',null,'Ah'], actionComplete:false};
const result = validatePokerSnapshot(bad);
assert.equal(result.ok, false);
assert(result.errors.includes('board_decode_gap'));
assert(result.errors.includes('action_history_incomplete'));
const blocked = gateBrainInput(bad, () => { called++; });
assert.equal(blocked.decided, false);
assert.equal(called, 1);
assert(validatePokerSnapshot({...good,toCall:70,heroStack:50}).errors.includes('to_call_exceeds_stack'));

console.log('snapshot-validator-v1 ok');
