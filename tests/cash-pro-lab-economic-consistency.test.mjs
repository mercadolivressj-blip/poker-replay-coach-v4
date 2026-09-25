import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode, proveDecisionNode } from '../src/cash-pro-lab/decision-node.js';
import { classifyRedZone, proveEconomicConsistency } from '../src/cash-pro-lab/economic-consistency.js';

const evidence=()=>Object.fromEntries(
  ['heroCards','board','heroPosition','effectiveStackBB','potBB','toCallBB','activePlayers','legalActions','actionHistory']
    .map(field=>[field,{source:'solver-fixture',confidence:1}])
);

function flopFacingBet(overrides={}){
  return createDecisionNode({
    handId:'econ-1',decisionId:'flop-1',heroCards:['Ah','Kd'],board:['Ks','8h','3h'],street:'flop',heroPosition:'BB',
    startingStackBB:100,effectiveStackBB:97,heroStackBB:97,potBB:8.5,toCallBB:3,activePlayers:2,
    legalActions:['FOLD','CALL','RAISE'],rakeProfile:'100z-high-rake',
    actionHistory:[
      {seq:1,street:'flop',actorPosition:'BB',action:'CHECK'},
      {seq:2,street:'flop',actorPosition:'BTN',action:'BET',amountBB:3},
    ],
    evidence:evidence(),
    ...overrides,
  });
}

const context={
  initialPotBB:5.5,
  amountSemantics:'delta',
  potSemantics:'includes-history-contributions',
};

test('economic proof exactly reconstructs current pot and to-call from explicit delta semantics',()=>{
  const proof=proveEconomicConsistency(flopFacingBet(),context);
  assert.equal(proof.ok,true);
  assert.equal(proof.reconstructed.potBB,8.5);
  assert.equal(proof.reconstructed.toCallBB,3);
  assert.deepEqual(proof.reconstructed.currentStreetCommitmentsBB,{BB:0,BTN:3});
});

test('economic proof rejects a pot that does not reconcile with the action ledger',()=>{
  const proof=proveEconomicConsistency(flopFacingBet({potBB:7.5}),context);
  assert.equal(proof.ok,false);
  assert.ok(proof.errors.includes('pot_reconstruction_mismatch'));
});

test('economic proof rejects an impossible check while facing a bet',()=>{
  const node=flopFacingBet({
    potBB:8.5,toCallBB:0,legalActions:['CHECK','BET'],
    actionHistory:[
      {seq:1,street:'flop',actorPosition:'BTN',action:'BET',amountBB:3},
      {seq:2,street:'flop',actorPosition:'BB',action:'CHECK'},
    ],
  });
  const proof=proveEconomicConsistency(node,context);
  assert.equal(proof.ok,false);
  assert.ok(proof.errors.includes('check_facing_bet:1'));
});

test('economic proof rejects action after an actor has folded',()=>{
  const node=flopFacingBet({
    potBB:5.5,toCallBB:0,legalActions:['CHECK','BET'],
    actionHistory:[
      {seq:1,street:'flop',actorPosition:'BTN',action:'FOLD'},
      {seq:2,street:'flop',actorPosition:'BTN',action:'CHECK'},
    ],
  });
  const proof=proveEconomicConsistency(node,context);
  assert.equal(proof.ok,false);
  assert.ok(proof.errors.some(e=>e.startsWith('actor_acted_after_fold:BTN')));
});

test('red zone marks river calls and stack-threatening decisions for extra proof',()=>{
  const node=createDecisionNode({
    heroCards:['Kh','3s'],board:['Kd','4s','2h','7c','3h'],street:'river',heroPosition:'BB',
    startingStackBB:100,effectiveStackBB:80,heroStackBB:40,potBB:60,toCallBB:40,activePlayers:2,
    legalActions:['FOLD','CALL'],rakeProfile:'100z-high-rake',actionHistory:[],evidence:evidence(),
  });
  const red=classifyRedZone(node);
  assert.equal(red.redZone,true);
  assert.equal(red.level,'CRITICAL');
  assert.ok(red.reasons.includes('river_facing_call'));
  assert.ok(red.reasons.includes('call_at_least_half_hero_stack'));
});

test('understanding proof can require exact economics specifically for red-zone nodes',()=>{
  const standard=flopFacingBet();
  const standardProof=proveDecisionNode(standard,{requireEconomicConsistencyForRedZone:true});
  assert.equal(standardProof.redZone.redZone,false);
  assert.equal(standardProof.ok,true);
  assert.equal(standardProof.economicProof,null);

  const red=createDecisionNode({
    heroCards:['Kh','3s'],board:['Kd','4s','2h','7c','3h'],street:'river',heroPosition:'BB',
    startingStackBB:100,effectiveStackBB:80,heroStackBB:40,potBB:60,toCallBB:40,activePlayers:2,
    legalActions:['FOLD','CALL'],rakeProfile:'100z-high-rake',actionHistory:[],evidence:evidence(),
  });
  const blocked=proveDecisionNode(red,{requireEconomicConsistencyForRedZone:true});
  assert.equal(blocked.ok,false);
  assert.ok(blocked.errors.includes('economic:initial_pot_missing'));
  assert.ok(blocked.errors.includes('economic:amount_semantics_not_delta'));

  const passed=proveDecisionNode(red,{
    requireEconomicConsistencyForRedZone:true,
    economicContext:{initialPotBB:60,amountSemantics:'delta',potSemantics:'includes-history-contributions'},
  });
  assert.equal(passed.ok,true);
  assert.equal(passed.economicProof.ok,true);
});
