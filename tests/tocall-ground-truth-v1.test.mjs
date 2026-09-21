import assert from 'node:assert/strict';
import fs from 'node:fs';

const file=new URL('../standalone-lab/calibration/tocall-ground-truth-v1.json',import.meta.url);
const truth=JSON.parse(fs.readFileSync(file,'utf8'));

assert.equal(truth.v,'ssj-tocall-v1');
assert.equal(truth.count,47);
assert.equal(truth.rows.length,47);
assert.deepEqual(truth.guards,{noAmb:true,buttonOK:true,typeOK:true});

for(let i=0;i<truth.rows.length;i++){
  const [decision,hand,layout,heroCommit,tableMax,toCall]=truth.rows[i];
  assert.equal(decision,i+1);
  assert(Number.isInteger(hand) && hand>=1 && hand<=23);
  assert(['check-bet','fold-call-raise'].includes(layout));
  assert(Number.isFinite(heroCommit) && heroCommit>=0);
  assert(Number.isFinite(tableMax) && tableMax>=heroCommit-1e-9);
  assert(Number.isFinite(toCall) && toCall>=0);
  assert(Math.abs(toCall-Math.max(0,tableMax-heroCommit))<0.011,`bad toCall at decision ${decision}`);
  if(layout==='check-bet') assert(toCall<=0.01,`check/bet window must have zero toCall at decision ${decision}`);
  if(layout==='fold-call-raise') assert(toCall>0.01,`call/raise window needs positive toCall at decision ${decision}`);
}

const d42=truth.rows.find(([i])=>i===42);
assert.equal(d42[5],41.75);
const d44=truth.rows.find(([i])=>i===44);
assert.equal(d44[5],12.6);
const d30=truth.rows.find(([i])=>i===30);
assert.equal(d30[1],17);
assert.equal(d30[5],0.25);

console.log('tocall-ground-truth-v1 ok: 47/47 button-consistent deltas');
