import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const session=JSON.parse(fs.readFileSync(path.join(root,'standalone-lab','calibration','session-2026-09-21-video4-ground-truth-v1.json'),'utf8'));
const action=JSON.parse(fs.readFileSync(path.join(root,'standalone-lab','calibration','session-2026-09-21-video4-action-gate-summary-v1.json'),'utf8'));

assert.equal(session.version,'ssj-poker-session-ground-truth-2026-09-21-video4-v1');
assert.equal(session.handCount,14);
assert.equal(session.decisionCount,35);
assert.equal(session.hands.length,14);
assert.equal(session.decisions.length,35);
assert.equal(session.manualAudit.blindCriticalErrors,0);
assert.equal(session.manualAudit.blindAbstentions,0);
assert.deepEqual(session.manualAudit.metrics,{
  heroCards:'35/35',boardCards:'72/72',heroStack:'35/35',pot:'35/35',toCall:'35/35',positions:'14/14',buttons:'35/35'
});

const card=/^(?:[2-9TJQKA])[hdcs]$/;
for(const h of session.hands){
  assert.equal(h.heroCards.length,2);
  assert(h.heroCards.every((c)=>card.test(c)));
  assert(h.dealtSeats.includes('hero'));
  assert(h.heroPosition);
}
let prev=-Infinity; let boardCards=0;
for(const d of session.decisions){
  assert(d.best_t>prev); prev=d.best_t;
  assert(['check-bet','fold-call-raise'].includes(d.layout));
  assert(d.heroCards.every((c)=>card.test(c)));
  assert([0,3,4,5].includes(d.board.length));
  assert(d.board.every((c)=>card.test(c)));
  boardCards+=d.board.length;
  assert(Number.isFinite(d.heroStack)&&d.heroStack>0);
  assert(Number.isFinite(d.pot)&&d.pot>0);
  assert(Number.isFinite(d.toCall)&&d.toCall>=0);
}
assert.equal(boardCards,72);
assert(session.decisions.some((d)=>Math.abs(d.pot-.07)<1e-9),'video4 must lock small-pot 0.07');
assert(session.decisions.some((d)=>Math.abs(d.toCall-.43)<1e-9),'video4 must lock river toCall 0.43');
assert(session.decisions.some((d)=>d.heroCards[0]==='7h'&&d.heroCards[1]==='7c'),'video4 must lock pocket sevens');

assert.equal(action.handCount,14);
assert.equal(action.decisionCount,35);
assert.equal(action.completeCount,35);
assert.equal(action.heroActionCompleteCount,35);
assert.equal(action.continuityCount,14);
assert.equal(action.unknownCount,0);
assert.equal(action.heroActions.length,35);
assert.deepEqual(action.actionCounts,{CALL:28,FOLD:42,RAISE:14,CHECK:23,BET:9});
assert(action.heroActions.every((x)=>['FOLD','CALL','RAISE','CHECK','BET'].includes(x.action)));
assert.equal(new Set(action.heroActions.map((x)=>x.decision)).size,35);

console.log('offline-video4-ground-truth-v1 ok: strict blind 14 hands / 35 decisions / 14 continuous hands / 0 UNKNOWN');
