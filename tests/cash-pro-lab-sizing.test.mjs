import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode, proveDecisionNode } from '../src/cash-pro-lab/decision-node.js';
import { evaluateCashDecision } from '../src/cash-pro-lab/cash-pro-lab.js';
import { domainForNodeFixture } from '../src/cash-pro-lab/oracle-domain.js';
import { texasSolverComboKey, texasSolverNodeToOracle } from '../src/cash-pro-lab/texassolver-export-adapter.js';

const evidence=()=>Object.fromEntries(
  ['heroCards','board','heroPosition','effectiveStackBB','potBB','toCallBB','activePlayers','legalActions','legalOptions','actionHistory']
    .map(field=>[field,{source:'solver-fixture',confidence:1}])
);

function sizedNode(){
  return createDecisionNode({
    handId:'sized',decisionId:'flop-sized',heroCards:['Ah','Kd'],board:['As','7c','2d'],street:'flop',heroPosition:'BTN',
    effectiveStackBB:100,heroStackBB:100,potBB:10,toCallBB:2,activePlayers:2,
    legalActions:['FOLD','CALL','RAISE'],
    legalOptions:[
      {id:'FOLD',action:'FOLD'},
      {id:'CALL',action:'CALL',amountBB:2},
      {id:'RAISE:12',action:'RAISE',amountBB:12,potFraction:1.2},
      {id:'RAISE:30',action:'RAISE',amountBB:30,potFraction:3},
    ],
    rakeProfile:'100z-high-rake',
    actionHistory:[{seq:1,street:'flop',actorPosition:'BB',action:'BET',amountBB:2}],
    evidence:evidence(),
  });
}

function choiceOracle(node){
  return {
    oracleId:'solver-a',source:'solver-a',family:'solver-a',choiceId:'RAISE:12',action:'RAISE',confidence:.98,
    domain:domainForNodeFixture(node),
    evByChoice:{FOLD:0,CALL:.20,'RAISE:12':.55,'RAISE:30':.10},
  };
}

test('understanding proof can require explicit aggressive sizing and legal-option evidence',()=>{
  const node=sizedNode();
  const proof=proveDecisionNode(node,{requireSizedAggression:true,requireLegalOptionsEvidence:true});
  assert.equal(proof.ok,true);
  assert.equal(proof.exactSizingReady,true);
});

test('student action type alone is blocked when multiple raise sizes are legal',async()=>{
  const node=sizedNode();
  const out=await evaluateCashDecision({
    node,student:async()=>({action:'RAISE'}),oracles:[choiceOracle(node)],
    consensusOptions:{requireDomainDescriptor:true},
  });
  assert.equal(out.status,'BLOCKED');
  assert.equal(out.phase,'STUDENT_SIZING');
});

test('exact student sizing choice is audited against exact teacher choice EV',async()=>{
  const node=sizedNode();
  const out=await evaluateCashDecision({
    node,student:async()=>({action:'RAISE',choiceId:'RAISE:30'}),oracles:[choiceOracle(node)],
    consensusOptions:{requireDomainDescriptor:true},
  });
  assert.equal(out.status,'STUDIED');
  assert.equal(out.audit.bestChoiceId,'RAISE:12');
  assert.equal(out.audit.studentChoiceId,'RAISE:30');
  assert.ok(out.audit.evLossBB>.44&&out.audit.evLossBB<.46);
});

test('TexasSolver combo key matches its descending internal card order',()=>{
  assert.equal(texasSolverComboKey(['Ah','Kd']),'AhKd');
  assert.equal(texasSolverComboKey(['2c','As']),'As2c');
});

test('TexasSolver EV export maps exact raw actions to canonical sizing choices',()=>{
  const node=sizedNode();
  const solveNode={
    actions:['FOLD','CALL','RAISE 12.000000','RAISE 30.000000'],
    evs:{AhKd:[0,.20,.55,.10]},
    strategy:{AhKd:[0,.15,.75,.10]},
  };
  const result=texasSolverNodeToOracle({
    node,solveNode,
    metadata:{
      artifactId:'texas-solver-flop-a',artifactVersion:'1',family:'texassolver-cfr-a',source:'TexasSolver-export',
      domain:domainForNodeFixture(node),evScaleToBB:1,confidence:.96,
      actionMap:{FOLD:'FOLD',CALL:'CALL','RAISE 12.000000':'RAISE:12','RAISE 30.000000':'RAISE:30'},
    },
  });
  assert.equal(result.ok,true);
  assert.equal(result.comboKey,'AhKd');
  assert.equal(result.oracle.choiceId,'RAISE:12');
  assert.equal(result.oracle.evByChoice['RAISE:12'],.55);
  assert.equal(result.oracle.strategyByChoice['RAISE:12'],.75);
});

test('TexasSolver export is rejected when a sizing lacks explicit canonical mapping',()=>{
  const node=sizedNode();
  const result=texasSolverNodeToOracle({
    node,solveNode:{actions:['FOLD','CALL','RAISE 12.000000'],evs:{AhKd:[0,.2,.5]}},
    metadata:{
      artifactId:'bad-map',artifactVersion:'1',family:'texassolver',domain:domainForNodeFixture(node),evScaleToBB:1,confidence:.9,
      actionMap:{FOLD:'FOLD',CALL:'CALL'},
    },
  });
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(e=>e.startsWith('action_map_missing:')));
  assert.ok(result.errors.includes('action_map_incomplete'));
});
