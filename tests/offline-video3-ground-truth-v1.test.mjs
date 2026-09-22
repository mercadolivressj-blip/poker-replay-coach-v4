import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const truth=JSON.parse(fs.readFileSync(path.join(root,'standalone-lab','calibration','session-2026-09-21-video3-ground-truth-v1.json'),'utf8'));
const action=JSON.parse(fs.readFileSync(path.join(root,'standalone-lab','calibration','session-2026-09-21-video3-action-gate-v1.json'),'utf8'));

assert.equal(truth.version,'ssj-poker-session-ground-truth-2026-09-21-video3-v1');
assert.equal(truth.handCount,19);
assert.equal(truth.hands.length,19);
assert.equal(truth.decisionCount,40);
assert.equal(truth.decisions.length,40);

const card=/^[2-9TJQKA][hdcs]$/;
for(const h of truth.hands){
  assert.equal(h.heroCards.length,2);
  assert(h.heroCards.every((c)=>card.test(c)));
  assert(h.dealtSeats.includes('hero'));
  assert(h.heroPosition);
}
for(const d of truth.decisions){
  assert(['check-bet','fold-call-raise'].includes(d.layout));
  assert.equal(d.heroCards.length,2);
  assert(d.heroCards.every((c)=>card.test(c)));
  assert([0,3,4,5].includes(d.board.length));
  assert(d.board.every((c)=>card.test(c)));
  assert(Number.isFinite(d.pot)&&d.pot>0);
  assert(Number.isFinite(d.heroStack)&&d.heroStack>0);
  assert(Number.isFinite(d.toCall)&&d.toCall>=0);
}

// Hand 3 is a legitimate BB walk: no physical Hero decision was missed.
const walkHand=truth.hands.find((h)=>h.hand===3);
assert.deepEqual(walkHand.heroCards,['Ah','8d']);
assert.equal(walkHand.heroPosition,'BB');
assert.equal(truth.decisions.some((d)=>d.hand===3),false);

// The blind third session exposed the clipped-prefix commitment bug. Keep the
// original miss documented and lock the corrected state as 1.20 - 0.10 = 1.10.
const critical=truth.decisions.find((d)=>d.i===11);
assert.equal(critical.hand,7);
assert.equal(critical.pot,1.65);
assert.equal(critical.heroStack,9.6);
assert.equal(critical.toCall,1.1);
assert.equal(truth.manualAudit.runtimeButtonOcrUsed,false);
assert.equal(truth.manualAudit.blindCriticalErrors.length,1);
assert.equal(truth.manualAudit.blindCriticalErrors[0].decision,11);
assert.equal(truth.manualAudit.blindCriticalErrors[0].blindValue,.2);
assert.equal(truth.manualAudit.blindCriticalErrors[0].truth,1.1);

assert.equal(action.version,'ssj-video3-action-ledger-with-fast-folds-v1');
assert.equal(action.decisionCount,40);
assert.equal(action.completeCount,40);
assert.equal(action.decisions.length,40);
assert(action.decisions.every((d)=>d.complete===true));
assert.equal(action.syntheticFastFoldCount,26);
assert.equal(Object.values(action.counts).reduce((a,b)=>a+b,0),129);
assert.equal(action.counts.FOLD,68);
assert.equal(action.walks.length,1);
assert.equal(action.walks[0].hand,3);
assert.equal(action.walks[0].complete,true);
assert.equal(action.walks[0].folds.length,5);
assert.deepEqual(action.walks[0].folds.map((x)=>x[0]).sort(),['lb','lt','rb','rt','top']);

console.log('offline-video3-ground-truth-v1 ok: 19 hands / 40 decisions / walk + clipped 1.20 + 26 fast folds');
