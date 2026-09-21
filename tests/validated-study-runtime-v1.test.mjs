import assert from 'node:assert/strict';
import { runValidatedStudyRuntime } from '../src/brain/validated-study-runtime.js';

let calls=0;
const runner=()=>{calls++;return {result:{action:'CHECK'}}};
const base={heroCards:['2s','2c'],board:['As','7d','9s','4d','Ah'],legalActions:['CHECK','BET'],heroPosition:'BB',pot:'2.14',toCall:'0',heroStack:'56.85',actionHistory:[{action:'CHECK'}]};

const ok=runValidatedStudyRuntime(base,{actionComplete:true,positionSource:'dealer-plus-occupied-seats-only'},runner);
assert.equal(ok.blocked,false);
assert.equal(calls,1);

const bad=runValidatedStudyRuntime({...base,board:['As','7d','9s',null,'Ah']},{actionComplete:true,positionSource:'dealer-plus-occupied-seats-only'},runner);
assert.equal(bad.blocked,true);
assert.equal(calls,1);
assert(bad.validation.errors.includes('board_decode_gap'));

const incomplete=runValidatedStudyRuntime(base,{actionComplete:false,positionSource:'dealer-plus-occupied-seats-only'},runner);
assert.equal(incomplete.blocked,true);
assert.equal(calls,1);
assert(incomplete.validation.errors.includes('action_history_incomplete'));

console.log('validated-study-runtime-v1 ok');
