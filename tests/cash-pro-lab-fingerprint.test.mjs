import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode } from '../src/cash-pro-lab/decision-node.js';

const evidence=(observedAt,confidence=1)=>Object.fromEntries(
  ['heroCards','board','heroPosition','startingStackBB','effectiveStackBB','potBB','toCallBB','activePlayers','legalActions','legalOptions','actionHistory']
    .map(field=>[field,{source:'replay-verified',confidence,observedAt}])
);

function base(overrides={}){
  return createDecisionNode({
    handId:'h1',decisionId:'d1',heroCards:['Ah','Kd'],board:['As','7c','2d'],street:'flop',heroPosition:'BTN',
    startingStackBB:100,effectiveStackBB:97.5,heroStackBB:97.5,potBB:10,toCallBB:2,activePlayers:2,
    legalActions:['FOLD','CALL','RAISE'],
    legalOptions:[{id:'FOLD',action:'FOLD'},{id:'CALL',action:'CALL',amountBB:2},{id:'RAISE:8',action:'RAISE',amountBB:8}],
    rakeProfile:'100z-high-rake',strategyProfile:'ranges-v1',
    actionHistory:[{seq:1,street:'flop',actorPosition:'BB',actorSeat:'right-high',action:'BET',amountBB:2,source:'telemetry',confidence:.99}],
    evidence:evidence(1000,.99),tags:['source-a'],assumptions:[],...overrides,
  });
}

test('same strategic spot keeps the same fingerprint across replay provenance and hand identity',()=>{
  const a=base();
  const b=base({
    handId:'another-hand',decisionId:'another-decision',tags:['source-b'],
    evidence:evidence(999999,.91),
    actionHistory:[{seq:1,street:'flop',actorPosition:'BB',actorSeat:'left-low',action:'BET',amountBB:2,source:'manual-verified',confidence:.91}],
  });
  assert.equal(a.fingerprint,b.fingerprint);
  assert.notEqual(a.observationFingerprint,b.observationFingerprint);
  assert.equal(a.fingerprintVersion,'cash-pro-lab-strategic-fingerprint-v3');
});

test('different starting stack profile produces a different strategic fingerprint even at same current stack',()=>{
  const a=base({startingStackBB:100,effectiveStackBB:60,heroStackBB:60});
  const b=base({startingStackBB:75,effectiveStackBB:60,heroStackBB:60});
  assert.notEqual(a.fingerprint,b.fingerprint);
});

test('different legal sizing tree produces a different strategic fingerprint',()=>{
  const a=base();
  const b=base({legalOptions:[{id:'FOLD',action:'FOLD'},{id:'CALL',action:'CALL',amountBB:2},{id:'RAISE:12',action:'RAISE',amountBB:12}]});
  assert.notEqual(a.fingerprint,b.fingerprint);
});

test('different strategy profile produces a different strategic fingerprint',()=>{
  const a=base({strategyProfile:'ranges-v1'});
  const b=base({strategyProfile:'ranges-v2'});
  assert.notEqual(a.fingerprint,b.fingerprint);
});

test('different action history sizing produces a different strategic fingerprint',()=>{
  const a=base();
  const b=base({actionHistory:[{seq:1,street:'flop',actorPosition:'BB',action:'BET',amountBB:5}]});
  assert.notEqual(a.fingerprint,b.fingerprint);
});
