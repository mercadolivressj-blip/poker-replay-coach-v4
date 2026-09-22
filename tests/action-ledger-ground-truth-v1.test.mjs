import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const file=new URL('../standalone-lab/calibration/action-ledger-ground-truth-v1.json',import.meta.url);
const truth=JSON.parse(fs.readFileSync(file,'utf8'));

assert.equal(truth.v,'ssj-action-ledger-v1');
assert.equal(truth.hands,23);
assert.equal(truth.decisions,47);
assert.equal(truth.actions,85);
assert.deepEqual(truth.counts,{FOLD:35,CHECK:16,CALL:12,BET:9,RAISE:13});
assert.equal(truth.guards.unknown,0);
assert.equal(truth.a.length,85);
assert.equal(truth.d.length,47);

const validActions=new Set(['FOLD','CHECK','CALL','BET','RAISE','ALLIN']);
for(const [hand,seat,street,action,amount] of truth.a){
  assert(Number.isInteger(hand) && hand>=1 && hand<=23);
  assert(['hero','lb','lt','top','rt','rb'].includes(seat));
  assert([0,3,4,5].includes(street));
  assert(validActions.has(action));
  assert(amount===null || (Number.isFinite(amount) && amount>=0));
}

for(let i=0;i<truth.d.length;i++){
  const [decision,hand,street,historyCount]=truth.d[i];
  assert.equal(decision,i+1,'all 47 Hero decisions must have an action-complete record');
  assert(Number.isInteger(hand) && hand>=1 && hand<=23);
  assert([0,3,4,5].includes(street));
  assert(Number.isInteger(historyCount) && historyCount>=0);
}

const hand17=truth.a.filter(([hand])=>hand===17).map(([,seat,,action])=>`${seat}:${action}`);
assert.deepEqual(hand17,truth.guards.hand17);
assert(truth.a.some(([h,s,,a,n])=>h===20 && s==='lt' && a==='BET' && n===41.75));
assert(truth.a.some(([h,s,,a,n])=>h===22 && s==='lt' && a==='RAISE' && n===13.75));
assert(!truth.a.some(([, , ,action])=>action==='UNKNOWN'));

console.log('action-ledger-ground-truth-v1 ok: 85 actions / 47 complete decisions');
