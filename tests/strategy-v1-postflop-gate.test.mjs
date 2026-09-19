import assert from 'node:assert/strict';
import { decideBrain, enforceLegal } from '../src/brain/decision.js';
import { STRATEGY_V1_MANIFEST } from '../src/brain/strategy-manifest.js';

const state={
  version:'vision-v1',
  heroCards:['Ah','Ad'],heroPresence:'present',
  board:['Ac','7d','2s'],boardPresence:'present',
  pot:'0.10',toCall:null,legalActions:['CHECK','BET'],
  players:2,activePlayers:2,heroPosition:'BTN',
  heroStack:'1.90',effectiveStack:'1.90',blinds:'0.01/0.02',
  seats:[],actionHistory:['BTN raises 0.06','BB calls 0.04'],
  confidence:.99,readerModel:'test',capturedAt:1,
};

assert.equal(STRATEGY_V1_MANIFEST.policyComplete,true);
assert.equal(STRATEGY_V1_MANIFEST.postflop.status,'active-frozen-policy-v4');
assert.equal(STRATEGY_V1_MANIFEST.decisionLayer.status,'active-final-frozen-v4');
assert.equal(STRATEGY_V1_MANIFEST.postflop.lowSupportRuntimeFallback,false);

const r=decideBrain(state,{format:'cash',heroIsPreflopAggressor:true});
assert.ok(r.decision);
assert.equal(r.engine,'POLICY V4');
assert.equal(r.strategyStatus.policyComplete,true);
assert.equal(r.strategyStatus.postflop,'active-frozen-policy-v4');
if(r.actionCode==='MIXED'){
  assert.ok(r.mixed);
  assert.ok(r.mixedActionCodes.length>=2);
  for(const code of r.mixedActionCodes) assert.ok(['CHECK','BET'].includes(code));
}else{
  assert.ok(['CHECK','BET'].includes(r.actionCode));
}

const badMix=enforceLegal(
  {decision:'ESTRATÉGIA MISTA: APOSTAR 33% / AUMENTAR',confidence:55,engine:'POLICY V4',reason:'test'},
  {...state,legalActions:['CHECK','BET']},
);
assert.equal(badMix.decision,null);
assert.equal(badMix.engine,'LEGAL MASK');

const goodMix=enforceLegal(
  {decision:'ESTRATÉGIA MISTA: APOSTAR 33% / PASSAR',confidence:55,engine:'POLICY V4',reason:'test'},
  state,
);
assert.equal(goodMix.actionCode,'MIXED');
assert.deepEqual(goodMix.mixedActionCodes,['BET','CHECK']);

console.log('strategy-v1 postflop active gate: OK');
