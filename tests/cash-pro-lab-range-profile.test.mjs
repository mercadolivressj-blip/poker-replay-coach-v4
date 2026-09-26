import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode } from '../src/cash-pro-lab/decision-node.js';
import { RANGE_PROFILE_100Z_SRP, derive100zSrpRanges, infer100zSrpFromNode } from '../src/cash-pro-lab/range-profile-100z.js';

function srpNode(overrides={}){
  return createDecisionNode({
    handId:'range-fixture',decisionId:'flop-root',heroCards:['Ah','Kd'],board:['As','7c','2d'],street:'flop',heroPosition:'BB',
    startingStackBB:100,effectiveStackBB:97.5,heroStackBB:97.5,potBB:5.5,toCallBB:0,activePlayers:2,
    legalActions:['CHECK','BET'],
    legalOptions:[{id:'CHECK',action:'CHECK'},{id:'BET:1.8',action:'BET',amountBB:1.8}],
    rakeProfile:RANGE_PROFILE_100Z_SRP.rakeProfile,
    strategyProfile:RANGE_PROFILE_100Z_SRP.profileId,
    actionHistory:[
      {seq:1,street:'preflop',actorPosition:'BTN',action:'RAISE',amountBB:2.5},
      {seq:2,street:'preflop',actorPosition:'BB',action:'CALL',amountBB:1.5},
    ],
    ...overrides,
  });
}

test('BTN RFI vs BB call derives non-empty frozen 100z ranges and correct IP/OOP',()=>{
  const out=derive100zSrpRanges({openerPosition:'BTN',defenderPosition:'BB'});
  assert.equal(out.ok,true);
  assert.equal(out.ipPosition,'BTN');
  assert.equal(out.oopPosition,'BB');
  assert.ok(out.openerRange.length>20);
  assert.ok(out.defenderRange.length>20);
  assert.match(out.openerRange,/(^|,)AA($|,)/);
  assert.match(out.openerRange,/(^|,)22:0\.5($|,)/);
  assert.equal(out.rangeIp,out.openerRange);
  assert.equal(out.rangeOop,out.defenderRange);
});

test('SB RFI vs BB call assigns BB in position postflop',()=>{
  const out=derive100zSrpRanges({openerPosition:'SB',defenderPosition:'BB'});
  assert.equal(out.ok,true);
  assert.equal(out.ipPosition,'BB');
  assert.equal(out.oopPosition,'SB');
  assert.equal(out.rangeIp,out.defenderRange);
  assert.equal(out.rangeOop,out.openerRange);
});

test('proper 100bb starting-stack heads-up SRP node is accepted with 97.5bb remaining',()=>{
  const out=infer100zSrpFromNode(srpNode());
  assert.equal(out.ok,true);
  assert.equal(out.openerPosition,'BTN');
  assert.equal(out.defenderPosition,'BB');
  assert.equal(out.nodeStrategyProfile,RANGE_PROFILE_100Z_SRP.profileId);
  assert.ok(out.rangeIp&&out.rangeOop);
});

test('50bb starting stack is rejected instead of inheriting 100bb ranges',()=>{
  const out=infer100zSrpFromNode(srpNode({startingStackBB:50,effectiveStackBB:47.5,heroStackBB:47.5}));
  assert.equal(out.ok,false);
  assert.ok(out.errors.includes('starting_stack_not_100bb'));
});

test('100bb start with a smaller remaining flop stack remains in the 100z range profile',()=>{
  const out=infer100zSrpFromNode(srpNode({startingStackBB:100,effectiveStackBB:65,heroStackBB:65}));
  assert.equal(out.ok,true);
});

test('multiway spot is rejected from heads-up SRP profile',()=>{
  const out=infer100zSrpFromNode(srpNode({activePlayers:3}));
  assert.equal(out.ok,false);
  assert.ok(out.errors.includes('not_heads_up'));
});

test('mismatched strategy profile is rejected',()=>{
  const out=infer100zSrpFromNode(srpNode({strategyProfile:'different-ranges-v2'}));
  assert.equal(out.ok,false);
  assert.ok(out.errors.includes('strategy_profile_mismatch'));
});

test('3bet or multiple preflop raises are rejected from RFI-call SRP profile',()=>{
  const out=infer100zSrpFromNode(srpNode({
    actionHistory:[
      {seq:1,street:'preflop',actorPosition:'BTN',action:'RAISE',amountBB:2.5},
      {seq:2,street:'preflop',actorPosition:'BB',action:'RAISE',amountBB:10},
      {seq:3,street:'preflop',actorPosition:'BTN',action:'CALL',amountBB:7.5},
    ],
  }));
  assert.equal(out.ok,false);
  assert.ok(out.errors.includes('not_single_rfi'));
});

test('unsupported opener/defender chart is rejected rather than approximated',()=>{
  const out=derive100zSrpRanges({openerPosition:'BB',defenderPosition:'BTN'});
  assert.equal(out.ok,false);
  assert.ok(out.errors.includes('unsupported_opener_position'));
});
