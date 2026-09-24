import assert from 'node:assert/strict';
import {icmEquities,icmWithBusted} from '../src/icm/icm.js';
import {terminalCallThreshold} from '../src/icm/allin-threshold.js';
const near=(a,b,e=1e-9)=>Math.abs(a-b)<=e;

const equal=icmEquities([100,100,100],[50,30,20]);
assert(near(equal[0],100/3));
assert(near(equal[0]+equal[1]+equal[2],100));

const busted=icmWithBusted([200,100,0],[50,30,20]);
assert.equal(busted[2],20);
assert(near(busted.reduce((a,b)=>a+b,0),100));

// Winner-take-all ICM is exactly chip share, so an all-in call threshold
// must collapse to ordinary chip-EV pot odds.
const wta=terminalCallThreshold({
  stacks:[30,30,40],payouts:[100,0,0],heroIndex:0,villainIndex:1,
  potBeforeCall:20,callCost:10
});
assert(near(wta.chipEvRequired,1/3));
assert(near(wta.equityRequired,wta.chipEvRequired));
assert(near(wta.icmPremiumPct,0));

// 4 left / 3 paid: risking an equal stack near the bubble must require
// more equity than raw pot odds in this symmetric terminal model.
const bubble=terminalCallThreshold({
  stacks:[20,20,20,20],payouts:[50,30,20,0],heroIndex:0,villainIndex:1,
  potBeforeCall:20,callCost:10
});
assert(bubble.equityRequired>bubble.chipEvRequired);
assert(bubble.icmPremiumPct>0);
assert(bubble.equityRequired<=1);

console.log('PASS — MTT terminal ICM regressions');
