import assert from 'node:assert/strict';
import { decideBrain } from '../src/brain/decision.js';
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

assert.equal(STRATEGY_V1_MANIFEST.policyComplete,false);
assert.notEqual(STRATEGY_V1_MANIFEST.postflop.status,'active');

const r=decideBrain(state,{format:'cash',heroIsPreflopAggressor:true});
assert.ok(r.decision);
assert.match(r.engine,/POSTFLOP BRAIN V1/);
assert.doesNotMatch(r.engine,/POLICY V4|POSTFLOP-POLICY-V4/i);
assert.equal(r.strategyStatus.policyComplete,false);
assert.notEqual(r.strategyStatus.postflop,'active');

console.log('strategy-v1 postflop fail-closed gate: OK');
