import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode } from '../src/cash-pro-lab/decision-node.js';
import { runCashClassroom } from '../src/cash-pro-lab/classroom-runner.js';
import { buildLeakReport } from '../src/cash-pro-lab/leak-report.js';

const evidence=()=>Object.fromEntries(
  ['heroCards','board','heroPosition','effectiveStackBB','potBB','toCallBB','activePlayers','legalActions','actionHistory']
    .map(field=>[field,{source:'solver-fixture',confidence:1}])
);

function riverNode(overrides={}){
  return createDecisionNode({
    handId:'classroom-hand',decisionId:'river-1',heroCards:['Kh','3s'],board:['Kd','4s','2h','7c','3h'],
    street:'river',heroPosition:'BB',effectiveStackBB:80,heroStackBB:80,potBB:60,toCallBB:40,activePlayers:2,
    legalActions:['FOLD','CALL','RAISE'],rakeProfile:'100z-high-rake',
    actionHistory:[
      {seq:1,street:'preflop',actorPosition:'BTN',action:'RAISE',amountBB:2.5},
      {seq:2,street:'preflop',actorPosition:'BB',action:'CALL',amountBB:1.5},
      {seq:3,street:'flop',actorPosition:'BB',action:'CHECK'},
      {seq:4,street:'flop',actorPosition:'BTN',action:'BET',amountBB:3.5},
      {seq:5,street:'flop',actorPosition:'BB',action:'CALL',amountBB:3.5},
      {seq:6,street:'turn',actorPosition:'BB',action:'CHECK'},
      {seq:7,street:'turn',actorPosition:'BTN',action:'BET',amountBB:10},
      {seq:8,street:'turn',actorPosition:'BB',action:'CALL',amountBB:10},
      {seq:9,street:'river',actorPosition:'BB',action:'CHECK'},
      {seq:10,street:'river',actorPosition:'BTN',action:'BET',amountBB:40},
    ],
    evidence:evidence(),tags:['river-bluffcatch'],...overrides,
  });
}

const oracleDomain={
  game:'NLHE_CASH_6MAX',currency:'BB',stackBB:{min:75,max:85},rakeProfiles:['100z-high-rake'],
  streets:['river'],playerMode:'heads-up',minPlayers:2,maxPlayers:2,evUnit:'BB',evSemantics:'action-ev-from-node',
};
const oracleA={oracleId:'solver-a',source:'solver',action:'CALL',confidence:0.95,domain:oracleDomain,evByAction:{FOLD:0,CALL:1.20,RAISE:-2.80}};
const oracleB={oracleId:'solver-b',source:'benchmark',action:'CALL',confidence:0.90,domain:oracleDomain,evByAction:{FOLD:0,CALL:1.00,RAISE:-2.40}};

test('classroom studies batches and ranks accumulated river EV loss',async()=>{
  const nodes=[
    riverNode({decisionId:'river-1',tags:['river-bluffcatch']}),
    riverNode({decisionId:'river-2',tags:['river-bluffcatch']}),
  ];
  const out=await runCashClassroom({
    nodes,
    student:async()=>({action:'RAISE'}),
    oracleProvider:async()=>[oracleA,oracleB],
  });
  assert.equal(out.totalNodes,2);
  assert.equal(out.studiedNodes,2);
  assert.equal(out.blockedNodes,0);
  assert.ok(out.evSummary.totalEvLossBB>7);
  const river=out.leakReport.byStreet.find(r=>r.key==='river');
  assert.ok(river);
  assert.equal(river.decisions,2);
  assert.ok(river.totalEvLossBB>7);
  const tag=out.leakReport.byTag.find(r=>r.key==='river-bluffcatch');
  assert.ok(tag);
  assert.ok(tag.totalEvLossBB>7);
});

test('classroom records teacher-consensus blocks instead of forcing a high-impact answer',async()=>{
  const out=await runCashClassroom({
    nodes:[riverNode()],
    student:async()=>({action:'CALL'}),
    oracleProvider:async()=>[oracleA],
  });
  assert.equal(out.studiedNodes,0);
  assert.equal(out.blockedNodes,1);
  assert.equal(out.blockedByPhase.TEACHER_CONSENSUS,1);
});

test('classroom rejects a solver whose stack domain does not contain the spot',async()=>{
  const wrongStack={...oracleB,oracleId:'solver-wrong-stack',domain:{...oracleDomain,stackBB:{min:95,max:105}}};
  const out=await runCashClassroom({
    nodes:[riverNode()],
    student:async()=>({action:'CALL'}),
    oracleProvider:async()=>[oracleA,wrongStack],
  });
  assert.equal(out.studiedNodes,0);
  assert.equal(out.blockedByPhase.TEACHER_CONSENSUS,1);
  const rejected=out.evaluations[0].consensus.rejected.find(r=>r.oracleId==='solver-wrong-stack');
  assert.ok(rejected);
  assert.ok(rejected.reasons.includes('domain_stack_mismatch'));
});

test('classroom rejects a bare domainVerified claim without a domain descriptor',async()=>{
  const claimOnly={...oracleB,oracleId:'claim-only',domain:null,domainVerified:true};
  const out=await runCashClassroom({
    nodes:[riverNode()],
    student:async()=>({action:'CALL'}),
    oracleProvider:async()=>[oracleA,claimOnly],
  });
  assert.equal(out.studiedNodes,0);
  const rejected=out.evaluations[0].consensus.rejected.find(r=>r.oracleId==='claim-only');
  assert.ok(rejected.reasons.includes('domain_descriptor_missing'));
});

test('oracle provider failure becomes a blocked lesson and does not crash the classroom',async()=>{
  const out=await runCashClassroom({
    nodes:[riverNode()],
    student:async()=>({action:'CALL'}),
    oracleProvider:async()=>{throw new Error('teacher offline');},
  });
  assert.equal(out.studiedNodes,0);
  assert.equal(out.blockedByPhase.ORACLE_PROVIDER,1);
  assert.match(out.evaluations[0].error,/teacher offline/);
});

test('leak report ranks groups by accumulated EV loss, not mismatch count',()=>{
  const evaluations=[
    {status:'STUDIED',node:{street:'river',heroPosition:'BB',tags:['expensive']},audit:{blocked:false,evLossBB:3,highImpact:true,severity:'catastrophic'}},
    {status:'STUDIED',node:{street:'flop',heroPosition:'BTN',tags:['cheap']},audit:{blocked:false,evLossBB:.15,highImpact:false,severity:'material'}},
    {status:'STUDIED',node:{street:'turn',heroPosition:'CO',tags:['cheap']},audit:{blocked:false,evLossBB:.15,highImpact:false,severity:'material'}},
  ];
  const report=buildLeakReport(evaluations);
  const expensive=report.byTag.find(r=>r.key==='expensive');
  const cheap=report.byTag.find(r=>r.key==='cheap');
  assert.equal(cheap.decisions,2);
  assert.equal(expensive.decisions,1);
  assert.ok(expensive.totalEvLossBB>cheap.totalEvLossBB);
  assert.equal(report.byTag[0].key,'expensive');
});
