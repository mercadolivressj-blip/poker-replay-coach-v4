import assert from 'node:assert/strict';
import { runValidatedStudyRuntime } from '../src/brain/validated-study-runtime.js';

let calls=0;
const runner=()=>{calls++;return {result:{action:'CHECK'}}};
const base={heroCards:['2s','2c'],heroPresence:'present',board:['As','7d','9s','4d','Ah'],legalActions:['CHECK','BET'],heroPosition:'BB',pot:'2.14',toCall:'0',heroStack:'56.85',actionHistory:[{action:'CHECK'}]};
const context={
  actionComplete:true,
  positionSource:'dealer-plus-occupied-seats-only',
  heroTurnConfirmed:true,
  buttonsSource:'physical-action-buttons',
  heroButtons:['CHECK','BET'],
  toCallSource:'commitment-delta',
  toCall:0,
};

const ok=runValidatedStudyRuntime(base,context,runner);
assert.equal(ok.blocked,false);
assert.equal(calls,1);

const bad=runValidatedStudyRuntime({...base,board:['As','7d','9s',null,'Ah']},context,runner);
assert.equal(bad.blocked,true);
assert.equal(calls,1);
assert(bad.validation.errors.includes('board_decode_gap'));

const incomplete=runValidatedStudyRuntime(base,{...context,actionComplete:false},runner);
assert.equal(incomplete.blocked,true);
assert.equal(calls,1);
assert(incomplete.validation.errors.includes('action_history_incomplete'));

// Pre-action checkboxes and stale/absent Hero never call the runner.
const preAction=runValidatedStudyRuntime(base,{...context,heroTurnConfirmed:false,buttonsSource:'pre-action-checkboxes'},runner);
assert.equal(preAction.blocked,true);
assert.equal(calls,1);
assert(preAction.validation.errors.includes('hero_turn_not_confirmed'));

const stale=runValidatedStudyRuntime({...base,heroPresence:'absent'},context,runner);
assert.equal(stale.blocked,true);
assert.equal(calls,1);
assert(stale.validation.errors.includes('hero_not_present'));

const badSource=runValidatedStudyRuntime(base,{...context,toCallSource:'button-ocr'},runner);
assert.equal(badSource.blocked,true);
assert.equal(calls,1);
assert(badSource.validation.errors.includes('to_call_source_invalid'));

console.log('validated-study-runtime-v1 ok');
