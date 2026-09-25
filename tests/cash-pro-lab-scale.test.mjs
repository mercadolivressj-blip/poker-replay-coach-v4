import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode } from '../src/cash-pro-lab/decision-node.js';
import { curriculumManifest, iterateCurriculumTickets, shardForTicket } from '../src/cash-pro-lab/curriculum-planner.js';
import { runCurriculumStream } from '../src/cash-pro-lab/scale-runner.js';
import { buildCoverageReport } from '../src/cash-pro-lab/coverage-report.js';
import { domainForNodeFixture } from '../src/cash-pro-lab/oracle-domain.js';

const evidence=()=>Object.fromEntries(
  ['heroCards','board','heroPosition','effectiveStackBB','potBB','toCallBB','activePlayers','legalActions','actionHistory']
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
    legalActions:['FOLD','CALL','RAISE'],rakeProfile:'100z-high-rake',
    actionHistory:[{seq:1,street:'flop',actorPosition:'BB',action:'BET',amountBB:2}],
    evidence:evidence(),tags:[`sample-${ticket.sampleIndex}`],
  });
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

test('scale runner counts only proved and teacher-audited nodes as studied',async()=>{
  const tickets=iterateCurriculumTickets({axes:singletonAxes,samplesPerCell:8,seed:'runner'});
  const out=await runCurriculumStream({
    tickets,split:null,nodeFactory:async ticket=>nodeForTicket(ticket),
    student:async()=>({action:'CALL',engine:'fixture-student'}),
    oracleProvider:async node=>[{
      oracleId:'fixture-solver',source:'solver-fixture',action:'CALL',confidence:.99,
      domain:domainForNodeFixture(node),evByAction:{FOLD:0,CALL:.4,RAISE:.1},
    }],
    checkpointEvery:3,
  });
  assert.equal(out.ticketsSeen,8);
  assert.equal(out.processedNodes,8);
  assert.equal(out.studiedNodes,8);
  assert.equal(out.blockedNodes,0);
  assert.equal(out.evSummary.totalEvLossBB,0);
  assert.match(out.note,/only STUDIED nodes/i);
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
