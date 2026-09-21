import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveHeroPosition, createFrozenPositionTracker } from '../src/core/frozen-position.js';

const file=new URL('../standalone-lab/calibration/hand-positions-ground-truth-v1.json',import.meta.url);
const truth=JSON.parse(fs.readFileSync(file,'utf8'));
assert.equal(truth.v,'ssj-hand-positions-v1');
assert.equal(truth.count,23);
assert.equal(truth.rows.length,23);

for(const [hand,start,dealer,dealt,expected] of truth.rows){
  assert(Number.isInteger(hand) && hand>=1 && hand<=23);
  assert(Number.isFinite(start));
  assert.equal(deriveHeroPosition(dealer,dealt),expected,`position mismatch hand ${hand}`);
}

const tracker=createFrozenPositionTracker();
const first=tracker.observe({handId:20,dealerSeat:'lt',dealtSeats:['hero','lb','lt','rt','rb']});
assert.equal(first.heroPosition,'UTG');
// Three opponents fold; position must remain the hand-start position.
const later=tracker.observe({handId:20,dealerSeat:'lt',dealtSeats:['hero','lt']});
assert.equal(later.heroPosition,'UTG');
assert.deepEqual(later.dealtSeats,['hero','lb','lt','rt','rb']);
// New hand is allowed to rotate.
const next=tracker.observe({handId:21,dealerSeat:'rt',dealtSeats:['hero','lt','rt','rb']});
assert.equal(next.heroPosition,'BB');

console.log('frozen-position-v1 ok: 23/23 hands');
