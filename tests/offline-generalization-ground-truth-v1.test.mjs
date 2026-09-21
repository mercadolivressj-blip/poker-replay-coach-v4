import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const session=JSON.parse(fs.readFileSync(path.join(root,'standalone-lab','calibration','session-2026-09-21-ground-truth-v1.json'),'utf8'));
const action=JSON.parse(fs.readFileSync(path.join(root,'standalone-lab','calibration','session-2026-09-21-action-gate-v1.json'),'utf8'));

assert.equal(session.version,'ssj-poker-session-ground-truth-2026-09-21-v1');
assert.equal(session.handCount,14);
assert.equal(session.hands.length,14);
assert.equal(session.decisionCount,31);
assert.equal(session.decisions.length,31);
assert.equal(action.decisionCount,31);
assert.equal(action.completeCount,31);
assert.equal(action.rows.length,31);
assert(action.rows.every((r)=>r.complete===true));

const card=/^[2-9TJQKA][hdcs]$/;
for(const h of session.hands){
  assert.equal(h.heroCards.length,2);
  assert(h.heroCards.every((c)=>card.test(c)));
  assert(h.heroPosition);
  assert(h.dealtSeats.includes('hero'));
}
let prev=-Infinity;
for(const d of session.decisions){
  assert(d.best_t>prev); prev=d.best_t;
  assert(['check-bet','fold-call-raise'].includes(d.layout));
  assert(d.heroCards.every((c)=>card.test(c)));
  assert([0,3,4,5].includes(d.board.length));
  assert(d.board.every((c)=>card.test(c)));
  assert(Number.isFinite(d.pot)&&d.pot>0);
  assert(Number.isFinite(d.heroStack)&&d.heroStack>0);
  assert(Number.isFinite(d.toCall)&&d.toCall>=0);
}

// Locks the independent-session cases that exposed the first-video overfit.
assert(session.decisions.some((d)=>d.heroCards.includes('6h')),'session 2 must exercise Hero rank 6');
assert(session.decisions.some((d)=>d.board.includes('Qc')),'session 2 must exercise board Qc');
assert(session.decisions.some((d)=>d.board.includes('8c')),'session 2 must exercise board 8c');
assert(session.decisions.some((d)=>Math.abs(d.pot-.08)<1e-9),'session 2 must exercise small-pot digit 8');
assert(session.decisions.some((d)=>Math.abs(d.toCall-.28)<1e-9),'session 2 must exercise larger micro-stakes toCall');

console.log('offline-generalization-ground-truth-v1 ok: 14 hands / 31 decisions / 31 complete histories');
