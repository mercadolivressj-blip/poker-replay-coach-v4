import assert from 'node:assert/strict';
import { runValidatedStudyRuntime } from '../src/brain/validated-study-runtime.js';

let calls=0;
const runner=()=>{calls++;return {result:{action:'CHECK'}}};
const base={heroCards:['2s','2c'],heroPresence:'present',board:['As','7d','9s','4d','Ah'],legalActions:['CHECK','BET'],heroPosition:'BB',pot:'2.14',toCall:'0',heroStack:'56.85',actionHistory:[{action:'CHECK'}]};
const context={
  actionLedgerStatus:{complete:true,source:'seat-state-ledger-v1',errors:[],eventCount:1,unresolved:0},
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

// Seat commitments are authoritative: a bogus OCR/button number is ignored.
const derived=runValidatedStudyRuntime(base,{
  ...context,
  toCall:99,
  toCallSource:'button-ocr',
  seatStates:{hero:{cardsPresent:true,commitment:1.75},lb:{cardsPresent:true,commitment:1.75}}
},runner);
assert.equal(derived.blocked,false);
assert.equal(derived.snapshot.toCall,0);
assert.equal(derived.snapshot.toCallSource,'commitment-delta');
assert.equal(calls,2);

const bad=runValidatedStudyRuntime({...base,board:['As','7d','9s',null,'Ah']},context,runner);
assert.equal(bad.blocked,true);
assert.equal(calls,2);
assert(bad.validation.errors.includes('board_decode_gap'));

const incomplete=runValidatedStudyRuntime(base,{...context,actionLedgerStatus:{complete:false,source:'seat-state-ledger-v1',errors:['ledger_unresolved_actions'],eventCount:1,unresolved:1}},runner);
assert.equal(incomplete.blocked,true);
assert.equal(calls,2);
assert(incomplete.validation.errors.includes('action_history_incomplete'));

const fakeLedger=runValidatedStudyRuntime(base,{...context,actionLedgerStatus:{complete:true,source:'transient-text-only'}},runner);
assert.equal(fakeLedger.blocked,true);
assert.equal(calls,2);
assert(fakeLedger.validation.errors.includes('action_ledger_source_invalid'));

// Pre-action checkboxes and stale/absent Hero never call the runner.
const preAction=runValidatedStudyRuntime(base,{...context,heroTurnConfirmed:false,buttonsSource:'pre-action-checkboxes'},runner);
assert.equal(preAction.blocked,true);
assert.equal(calls,2);
assert(preAction.validation.errors.includes('hero_turn_not_confirmed'));

const stale=runValidatedStudyRuntime({...base,heroPresence:'absent'},context,runner);
assert.equal(stale.blocked,true);
assert.equal(calls,2);
assert(stale.validation.errors.includes('hero_not_present'));

const badSource=runValidatedStudyRuntime(base,{...context,toCallSource:'button-ocr'},runner);
assert.equal(badSource.blocked,true);
assert.equal(calls,2);
assert(badSource.validation.errors.includes('to_call_source_invalid'));

console.log('validated-study-runtime-v1 ok');
