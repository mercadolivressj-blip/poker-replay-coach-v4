import assert from 'node:assert/strict';
import { createHandTransitionV1 } from '../src/core/hand-transition.js';

{
  const h=createHandTransitionV1();
  let r=h.observeHero({heroCards:['Ah','Kd'],heroPresence:'present',confidence:.95},[]);
  assert.equal(r.type,'HAND_STARTED');
}
{
  const h=createHandTransitionV1();
  let r=h.observeHero({heroCards:['Qc','Jh'],heroPresence:'present',confidence:.99},['Ah','Kd']);
  assert.equal(r.type,'NO_CHANGE');
  r=h.observeHero({heroCards:['Qc','Jh'],heroPresence:'present',confidence:.99},['Ah','Kd']);
  assert.equal(r.type,'NEW_HAND');
  assert.deepEqual(r.heroCards,['Qc','Jh']);
}
{
  const h=createHandTransitionV1();
  let r=h.observeHero({heroCards:[],heroPresence:'absent',confidence:.99},['Ah','Kd']);
  assert.equal(r.type,'NO_CHANGE');
  r=h.observeHero({heroCards:[],heroPresence:'absent',confidence:.99},['Ah','Kd']);
  assert.equal(r.type,'HAND_ENDED');
}
console.log('hand-transition-v1: OK');
