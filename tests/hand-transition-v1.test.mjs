import assert from 'node:assert/strict';
import { createHandTransitionV1 } from '../src/core/hand-transition.js';

{
  const h=createHandTransitionV1();
  let r=h.observeHero({heroCards:['Ah','Kd'],heroPresence:'present',confidence:.95,dealerSeat:'rt'},[]);
  assert.equal(r.type,'HAND_STARTED');
}
{
  const h=createHandTransitionV1();
  h.observeHero({heroCards:['Ah','Kd'],heroPresence:'present',confidence:.99,dealerSeat:'rt'},[]);
  let r=h.observeHero({heroCards:['Qc','Jh'],heroPresence:'present',confidence:.99,dealerSeat:'rb'},['Ah','Kd']);
  assert.equal(r.type,'NO_CHANGE');
  r=h.observeHero({heroCards:['Qc','Jh'],heroPresence:'present',confidence:.99,dealerSeat:'rb'},['Ah','Kd']);
  assert.equal(r.type,'NEW_HAND');
  assert.deepEqual(r.heroCards,['Qc','Jh']);
}
{
  // Transient disappearance does not end/clear a hand.
  const h=createHandTransitionV1();
  h.observeHero({heroCards:['7s','7c'],heroPresence:'present',confidence:.99,dealerSeat:'top'},[]);
  let r=h.observeHero({heroCards:[],heroPresence:'absent',confidence:.99,dealerSeat:'top'},['7s','7c']);
  assert.equal(r.type,'HAND_SUSPENDED');
  r=h.observeHero({heroCards:[],heroPresence:'absent',confidence:.99,dealerSeat:'top'},['7s','7c']);
  assert.equal(r.type,'HAND_SUSPENDED');
  r=h.observeHero({heroCards:['7s','7c'],heroPresence:'present',confidence:.99,dealerSeat:'top'},['7s','7c']);
  assert.equal(r.type,'HAND_RESUMED');
  assert.equal(r.clear,false);
}
{
  // Same exact hole cards can be a real new hand, but only with dealer rotation
  // and two matching observations.
  const h=createHandTransitionV1();
  h.observeHero({heroCards:['7s','7c'],heroPresence:'present',confidence:.99,dealerSeat:'top'},[]);
  let r=h.observeHero({heroCards:['7s','7c'],heroPresence:'present',confidence:.99,dealerSeat:'rt'},['7s','7c']);
  assert.equal(r.type,'NO_CHANGE');
  r=h.observeHero({heroCards:['7s','7c'],heroPresence:'present',confidence:.99,dealerSeat:'rt'},['7s','7c']);
  assert.equal(r.type,'NEW_HAND');
  assert.match(r.reason,/dealer rotated/i);
}
console.log('hand-transition-v1: OK');
