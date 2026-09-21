import assert from 'node:assert/strict';
import { validatePokerSnapshot, gateBrainInput } from '../src/core/snapshot-validator.js';

const good = {
  heroCards:['2s','2c'],
  heroPresence:'present',
  board:['As','7d','9s','4d','Ah'],
  heroButtons:['CHECK','BET'],
  heroTurnConfirmed:true,
  buttonsSource:'physical-action-buttons',
  heroPosition:'BB',
  positionSource:'dealer-plus-occupied-seats-only',
  pot:2.14,
  toCall:0,
  toCallSource:'commitment-delta',
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
assert(validatePokerSnapshot({...good,heroTurnConfirmed:false}).errors.includes('hero_turn_not_confirmed'));
assert(validatePokerSnapshot({...good,buttonsSource:'pre-action-checkboxes'}).errors.includes('hero_buttons_source_invalid'));
assert(validatePokerSnapshot({...good,toCallSource:'button-ocr'}).errors.includes('to_call_source_invalid'));
assert(validatePokerSnapshot({...good,heroPresence:'absent'}).errors.includes('hero_not_present'));
assert(validatePokerSnapshot({...good,heroCards:['2s','2s']}).errors.includes('duplicate_card'));
assert(validatePokerSnapshot({...good,toCall:1,heroButtons:['CHECK','BET']}).errors.includes('buttons_to_call_inconsistent'));
assert(validatePokerSnapshot({...good,toCall:0,heroButtons:['FOLD','CALL','RAISE']}).errors.includes('buttons_to_call_inconsistent'));

console.log('snapshot-validator-v1 ok');
