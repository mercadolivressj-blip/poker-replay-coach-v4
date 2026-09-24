import assert from 'node:assert/strict';
import {chipEvCallThreshold,chipEvCall,chipEvJam} from '../src/math/terminal-chip-ev.js';

const near=(a,b,e=1e-10)=>Math.abs(a-b)<=e;
const t=chipEvCallThreshold({potBeforeCall:150,callCost:50});
assert(near(t.equityRequired,.25));

let r=chipEvCall({potBeforeCall:150,callCost:50,equity:.30});
assert(r.profitable);assert(near(r.evChips,10));
r=chipEvCall({potBeforeCall:150,callCost:50,equity:.20});
assert.equal(r.profitable,false);assert(near(r.evChips,-10));

let j=chipEvJam({potBeforeJam:100,heroJam:200,opponentCall:200,foldProbability:.5,equityWhenCalled:.5});
assert(j.profitable);assert(near(j.evCalledChips,50));assert(near(j.evChips,75));

j=chipEvJam({potBeforeJam:100,heroJam:200,opponentCall:200,foldProbability:0,equityWhenCalled:.3});
assert.equal(j.profitable,false);assert(near(j.evChips,-50));

console.log('PASS — terminal chipEV regressions');
