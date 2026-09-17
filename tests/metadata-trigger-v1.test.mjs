import assert from 'node:assert/strict';
import { createMetadataTriggerState, observeMetadataTrigger, markMetadataRead } from '../src/core/metadata-trigger.js';

const base=(patch={})=>({heroCards:['Ah','Kd'],board:[],pot:'0.03',toCall:null,legalActions:['FOLD','RAISE'],heroPosition:null,...patch});
let t=createMetadataTriggerState();
let o=observeMetadataTrigger(t,base(),1000);
assert.equal(o.shouldRead,true); assert.equal(o.reason,'first-hand');
t=markMetadataRead(o.state,base(),1000);
// Same state must not spam full reads.
o=observeMetadataTrigger(t,base(),2000); assert.equal(o.shouldRead,false);
// Pot change inside throttle is pending, not fired.
o=observeMetadataTrigger(o.state,base({pot:'0.05'}),2200); assert.equal(o.shouldRead,false); assert.equal(o.throttled,true); assert.equal(o.pendingReason,'pot-change');
// Once throttle clears, next meaningful change fires.
t=o.state;
o=observeMetadataTrigger(t,base({pot:'0.05',legalActions:['FOLD','CALL','RAISE'],toCall:'0.02'}),2600); assert.equal(o.shouldRead,true); assert(['hero-actions-change','to-call-change','pot-change'].includes(o.reason));
t=markMetadataRead(o.state,base({pot:'0.05',legalActions:['FOLD','CALL','RAISE'],toCall:'0.02'}),2600);
// Street change is a metadata event.
o=observeMetadataTrigger(t,base({board:['2c','7d','Jh'],pot:'0.11',legalActions:['CHECK','BET'],toCall:null}),4200); assert.equal(o.shouldRead,true); assert.equal(o.reason,'street-change');
t=markMetadataRead(o.state,base({board:['2c','7d','Jh'],pot:'0.11',legalActions:['CHECK','BET']}),4200);
// New Hero cards = new hand.
o=observeMetadataTrigger(t,base({heroCards:['Qs','Qd'],board:[],pot:'0.03',legalActions:['FOLD','RAISE']}),6000); assert.equal(o.shouldRead,true); assert.equal(o.reason,'new-hand');
console.log('metadata-trigger-v1 regressions: OK');
