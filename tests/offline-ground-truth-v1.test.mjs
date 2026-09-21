import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const file=path.join(root,'standalone-lab','calibration','session-2026-09-20-ground-truth-v2.json');
const truth=JSON.parse(fs.readFileSync(file,'utf8'));

assert.equal(truth.version,'ssj-poker-session-ground-truth-v2');
assert.match(truth.timelineSource,/sequential-ffmpeg-decode/i);
assert.equal(truth.handCount,23);
assert.equal(truth.handStartsSeconds.length,23);
assert.equal(truth.hands.length,23);
assert.equal(truth.heroDecisionCount,47);
assert.equal(truth.heroDecisionWindows.length,47);

const sorted=(xs)=>xs.every((v,i)=>i===0 || v>xs[i-1]);
assert(sorted(truth.handStartsSeconds),'hand starts must be strictly increasing');
const bestTimes=truth.heroDecisionWindows.map((x)=>x.best_t);
assert(sorted(bestTimes),'decision anchors must be strictly increasing');
assert.equal(new Set(bestTimes).size,bestTimes.length,'decision anchors must be unique');

const card=/^[2-9TJQKA][hdcs]$/;
for(const h of truth.hands){
  assert(Number.isInteger(h.hand) && h.hand>=1 && h.hand<=23);
  assert.equal(h.heroCards.length,2,`hand ${h.hand} needs two Hero cards`);
  assert(h.heroCards.every((c)=>card.test(c)),`invalid Hero cards on hand ${h.hand}`);
}
const ranks=new Set(truth.hands.flatMap((h)=>h.heroCards.map((c)=>c[0])));
const suits=new Set(truth.hands.flatMap((h)=>h.heroCards.map((c)=>c[1])));
for(const r of '2345789TJQKA') assert(ranks.has(r),`Hero labels missing rank ${r}`);
for(const s of 'hdcs') assert(suits.has(s),`Hero labels missing suit ${s}`);

const validLayouts=new Set(['check-bet','fold-call-raise']);
let priorEnd=-Infinity;
for(const row of truth.heroDecisionWindows){
  assert(Number.isInteger(row.i) && row.i>=1 && row.i<=47);
  assert(Number.isInteger(row.hand) && row.hand>=1 && row.hand<=23,`invalid hand at ${row.best_t}`);
  assert(Number.isFinite(row.start) && Number.isFinite(row.end) && Number.isFinite(row.best_t));
  assert(row.start<=row.best_t && row.best_t<=row.end,`best_t outside window ${row.i}`);
  assert(row.start>priorEnd,`decision windows overlap at ${row.i}`);
  priorEnd=row.end;
  assert(validLayouts.has(row.layout),`invalid layout at ${row.best_t}`);
  assert(Number.isFinite(row.heroStack) && row.heroStack>0,`invalid Hero stack at ${row.best_t}`);
}

// Two windows previously absent from the coarse/random-seek dataset are now locked.
assert(truth.heroDecisionWindows.some((x)=>Math.abs(x.best_t-387.8)<0.001 && x.layout==='check-bet'));
assert(truth.heroDecisionWindows.some((x)=>Math.abs(x.best_t-414.2)<0.001 && x.layout==='check-bet'));

// Known same-hand continuity: hand 22 spans decisions near 863s and 882s.
assert(truth.heroDecisionWindows.some((x)=>x.hand===22 && x.best_t<870));
assert(truth.heroDecisionWindows.some((x)=>x.hand===22 && x.best_t>880));

// Leading-digit regression: exact decision frame is US$ 40,78, never 0,78.
assert.equal(truth.heroDecisionWindows.find((x)=>x.i===44)?.heroStack,40.78);

console.log('offline-ground-truth-v2 ok: 23 hands / 47 decisions');
