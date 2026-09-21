import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const file=path.join(root,'standalone-lab','calibration','session-2026-09-20-ground-truth-v1.json');
const truth=JSON.parse(fs.readFileSync(file,'utf8'));

assert.equal(truth.version,'ssj-poker-session-ground-truth-v1');
assert.equal(truth.handCount,23);
assert.equal(truth.handStartsSeconds.length,23);
assert.equal(truth.heroDecisionCount,45);
assert.equal(truth.heroDecisionAnchors.length,45);
assert(!truth.handStartsSeconds.includes(868.5),'868.5s is a known false hand split');
assert(truth.handStartsSeconds.includes(859),'859s hand must exist');
assert(truth.handStartsSeconds.includes(961),'next real hand begins at 961s');

const sorted=(xs)=>xs.every((v,i)=>i===0 || v>xs[i-1]);
assert(sorted(truth.handStartsSeconds),'hand starts must be strictly increasing');
const decisionTimes=truth.heroDecisionAnchors.map((x)=>x.t);
assert(sorted(decisionTimes),'decision anchors must be strictly increasing');
assert.equal(new Set(decisionTimes).size,decisionTimes.length,'decision anchors must be unique');

const validLayouts=new Set(['check-bet','fold-call-raise']);
for(const row of truth.heroDecisionAnchors){
  assert(Number.isInteger(row.hand) && row.hand>=1 && row.hand<=23,`invalid hand at ${row.t}`);
  assert(Number.isFinite(row.t) && row.t>=0 && row.t<=truth.durationSeconds,`invalid time ${row.t}`);
  assert(validLayouts.has(row.layout),`invalid layout at ${row.t}`);
}

assert.equal(truth.falseSplitRegressions.length,1);
assert.equal(truth.falseSplitRegressions[0].t,868.5);
assert.equal(truth.falseSplitRegressions[0].handStart,859);

// The known continuous hand must have physical Hero decisions on both sides of
// the false split, proving this is not merely an idle gap between hands.
assert(truth.heroDecisionAnchors.some((x)=>x.hand===22 && x.t<868.5));
assert(truth.heroDecisionAnchors.some((x)=>x.hand===22 && x.t>868.5));

console.log('offline-ground-truth-v1 ok: 23 hands / 45 decisions');
