import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode } from '../src/cash-pro-lab/decision-node.js';
import { curriculumManifest, iterateCurriculumTickets, shardForTicket } from '../src/cash-pro-lab/curriculum-planner.js';
import { runCurriculumStream } from '../src/cash-pro-lab/scale-runner.js';
import { buildCoverageReport } from '../src/cash-pro-lab/coverage-report.js';
import { domainForNodeFixture } from '../src/cash-pro-lab/oracle-domain.js';
import { buildOracleConsensus } from '../src/cash-pro-lab/oracle-consensus.js';
import { createArtifactOracleProvider, createOracleArtifactIndex } from '../src/cash-pro-lab/oracle-artifact.js';

const evidence=()=>Object.fromEntries(
  ['heroCards','board','heroPosition','effectiveStackBB','potBB','toCallBB','activePlayers','legalActions','legalOptions','actionHistory']
    .map(field=>[field,{source:'solver-fixture',confidence:1}])
);

const singletonAxes={
  effectiveStackBB:[100],heroPosition:['BTN'],street:['flop'],activePlayers:[2],
  potClass:['medium'],facingClass:['bet-small'],initiative:['villain'],textureClass:['dry'],
};

function nodeForTicket(ticket){
  return createDecisionNode({
    handId:`scale-${ticket.ordinal}`,decisionId:`d-${ticket.ordinal}`,
    heroCards:['Ah','Kd'],board:['As','7c','2d'],street:'flop',heroPosition:'BTN',
    effectiveStackBB:100,heroStackBB:100,potBB:10,toCallBB:2,activePlayers:2,
    legalActions:['FOLD','CALL','RAISE'],
    legalOptions:[
      {id:'FOLD',action:'FOLD'},
      {id:'CALL',action:'CALL',amountBB:2},
      {id:'RAISE:8',action:'RAISE',amountBB:8},
    ],
    rakeProfile:'100z-high-rake',strategyProfile:'fixture-gto-ranges-v1',
    actionHistory:[{seq:1,street:'flop',actorPosition:'BB',action:'BET',amountBB:2}],
    evidence:evidence(),tags:[`sample-${ticket.sampleIndex}`],
  });
}

function highImpactNode(){
  return createDecisionNode({
    handId:'hi',decisionId:'river-hi',heroCards:['Ah','Kd'],board:['As','7c','2d','3h','9s'],
    street:'river',heroPosition:'BB',effectiveStackBB:100,heroStackBB:100,potBB:60,toCallBB:40,activePlayers:2,
    legalActions:['FOLD','CALL','RAISE'],rakeProfile:'100z-high-rake',
    actionHistory:[{seq:1,street:'river',actorPosition:'BTN',action:'BET',amountBB:40}],
    evidence:evidence(),tags:['river-high-impact'],
  });
}

function oracleFor(node,{id='oracle',family='family-a',callEV=.4,raiseEV=.1}={}){
  return {
    oracleId:id,source:id,family,action:'CALL',confidence:.99,domain:domainForNodeFixture(node),
    evByAction:{FOLD:0,CALL:callEV,RAISE:raiseEV},
  };
}

test('default curriculum manifest defines more than three million deterministic study tickets without materializing them',()=>{
  const manifest=curriculumManifest();
  assert.equal(manifest.cells,829440);
  assert.equal(manifest.samplesPerCell,4);
  assert.equal(manifest.tickets,3317760);
  assert.match(manifest.note,/not solver-certified/i);
});

test('curriculum ticket sequence and train-dev-holdout assignment are deterministic',()=>{
  const options={axes:singletonAxes,samplesPerCell:12,seed:'fixed-seed'};
  const a=[...iterateCurriculumTickets(options)];
  const b=[...iterateCurriculumTickets(options)];
  assert.deepEqual(a,b);
  assert.equal(a.length,12);
  assert.ok(a.every(row=>['train','dev','holdout'].includes(row.split)));
  assert.equal(new Set(a.map(row=>row.sampleSeed)).size,12);
});

test('sharding assigns every ticket to one deterministic worker',()=>{
  const rows=[...iterateCurriculumTickets({axes:singletonAxes,samplesPerCell:50,seed:'shards'})];
  const assignments=rows.map(row=>shardForTicket(row,7));
  assert.ok(assignments.every(x=>Number.isInteger(x)&&x>=0&&x<7));
  assert.deepEqual(assignments,rows.map(row=>shardForTicket(row,7)));
  assert.ok(new Set(assignments).size>1);
});

test('scale runner counts only exact-state proved and teacher-audited nodes as studied',async()=>{
  const tickets=iterateCurriculumTickets({axes:singletonAxes,samplesPerCell:8,seed:'runner'});
  const out=await runCurriculumStream({
    tickets,split:null,nodeFactory:async ticket=>nodeForTicket(ticket),
    student:async()=>({action:'CALL',engine:'fixture-student'}),
    oracleProvider:async node=>[oracleFor(node)],
    checkpointEvery:3,
  });
  assert.equal(out.ticketsSeen,8);
  assert.equal(out.processedNodes,8);
  assert.equal(out.studiedNodes,8);
  assert.equal(out.blockedNodes,0);
  assert.equal(out.evSummary.totalEvLossBB,0);
  assert.equal(out.proofOptions.requireSizedAggression,true);
  assert.equal(out.proofOptions.requireLegalOptionsEvidence,true);
  assert.equal(out.proofOptions.requireStrategyProfile,true);
  assert.match(out.note,/only STUDIED nodes/i);
});

test('strict high-impact consensus rejects two teachers from the same family',()=>{
  const node=highImpactNode();
  const result=buildOracleConsensus(node,[
    oracleFor(node,{id:'a1',family:'same-family'}),
    oracleFor(node,{id:'a2',family:'same-family'}),
  ],{requireDomainDescriptor:true,requireIndependentFamilies:true});
  assert.equal(result.blocked,true);
  assert.equal(result.reason,'insufficient_independent_oracles');
});

test('strict consensus quarantines teachers whose action EVs disagree beyond tolerance',()=>{
  const node=highImpactNode();
  const result=buildOracleConsensus(node,[
    oracleFor(node,{id:'a',family:'solver-a',callEV:.2}),
    oracleFor(node,{id:'b',family:'solver-b',callEV:2.0}),
  ],{requireDomainDescriptor:true,requireIndependentFamilies:true,maxEvSpreadBB:.75});
  assert.equal(result.blocked,true);
  assert.equal(result.reason,'oracle_ev_disagreement');
  assert.ok(result.divergentChoices.includes('CALL'));
  assert.ok(result.divergentActions.includes('CALL'));
});

test('offline teacher artifacts only answer exact node fingerprints and matching fingerprint version',async()=>{
  const node=highImpactNode();
  const domain=domainForNodeFixture(node);
  const artifacts=[
    {metadata:{artifactId:'solver-a-river',artifactVersion:'1',fingerprintVersion:node.fingerprintVersion,family:'solver-a',source:'solver-a',domain},rows:[{fingerprint:node.fingerprint,action:'CALL',evByAction:{FOLD:0,CALL:.5,RAISE:.1},confidence:.99}]},
    {metadata:{artifactId:'solver-b-river',artifactVersion:'7',fingerprintVersion:node.fingerprintVersion,family:'solver-b',source:'solver-b',domain},rows:[{fingerprint:node.fingerprint,action:'CALL',evByAction:{FOLD:0,CALL:.45,RAISE:.05},confidence:.97}]},
  ];
  const provider=createArtifactOracleProvider(artifacts);
  const exact=await provider(node);
  assert.equal(exact.length,2);
  const wrong=await provider({...node,fingerprint:'different-fingerprint'});
  assert.equal(wrong.length,0);
  const wrongVersion=await provider({...node,fingerprintVersion:'old-fingerprint-v1'});
  assert.equal(wrongVersion.length,0);
});

test('oracle artifact rejects duplicate fingerprints instead of silently overwriting them',()=>{
  const node=highImpactNode();
  const domain=domainForNodeFixture(node);
  const index=createOracleArtifactIndex({
    metadata:{artifactId:'dup',artifactVersion:'1',fingerprintVersion:node.fingerprintVersion,family:'solver-a',source:'solver-a',domain},
    rows:[
      {fingerprint:node.fingerprint,action:'CALL',evByAction:{FOLD:0,CALL:.5}},
      {fingerprint:node.fingerprint,action:'CALL',evByAction:{FOLD:0,CALL:.6}},
    ],
  });
  assert.equal(index.indexedCount,1);
  assert.equal(index.rejectedCount,1);
  assert.ok(index.errors[0].reasons.includes('duplicate_fingerprint'));
});

test('coverage report detects fingerprint leakage into holdout',()=>{
  const base={status:'STUDIED',audit:{evLossBB:.2,highImpact:false},ticket:{axes:{street:'flop',heroPosition:'BTN',effectiveStackBB:100,activePlayers:2,potClass:'medium',facingClass:'bet-small',textureClass:'dry',initiative:'villain'}}};
  const rows=[
    {...base,ticket:{...base.ticket,split:'train'},node:{fingerprint:'same-fp'}},
    {...base,ticket:{...base.ticket,split:'holdout'},node:{fingerprint:'same-fp'}},
  ];
  const report=buildCoverageReport(rows);
  assert.equal(report.leakage.clean,false);
  assert.equal(report.leakage.trainHoldoutFingerprintOverlap,1);
  assert.ok(report.warnings.includes('train_holdout_fingerprint_leakage'));
});
