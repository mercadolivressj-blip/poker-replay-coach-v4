import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode } from '../src/cash-pro-lab/decision-node.js';
import { domainForNodeFixture } from '../src/cash-pro-lab/oracle-domain.js';
import { createTeacherRegistry, createRegistryOracleProvider, teacherLaneForNode } from '../src/cash-pro-lab/teacher-registry.js';
import { buildStudyAccounting, validateStudyAccounting } from '../src/cash-pro-lab/study-accounting.js';

function node(overrides={}){
  return createDecisionNode({
    heroCards:['Ah','Kd'],board:['As','7c','2d'],street:'flop',heroPosition:'BTN',
    effectiveStackBB:100,heroStackBB:100,potBB:10,toCallBB:2,activePlayers:2,
    legalActions:['FOLD','CALL','RAISE'],
    legalOptions:[{id:'FOLD',action:'FOLD'},{id:'CALL',action:'CALL',amountBB:2},{id:'RAISE:8',action:'RAISE',amountBB:8}],
    rakeProfile:'100z-high-rake',strategyProfile:'ranges-v1',
    actionHistory:[{seq:1,street:'flop',actorPosition:'BB',action:'BET',amountBB:2}],...overrides,
  });
}

test('teacher lane separates preflop, heads-up postflop and multiway postflop',()=>{
  assert.equal(teacherLaneForNode(node()),'postflop-heads-up');
  assert.equal(teacherLaneForNode(node({activePlayers:3})),'postflop-multiway');
  assert.equal(teacherLaneForNode(node({board:[],street:'preflop'})),'preflop');
});

test('teacher registry never invokes a heads-up postflop teacher for multiway',async()=>{
  const hu=node();
  let calls=0;
  const registry=createTeacherRegistry([{
    teacherId:'hu-solver',family:'solver-a',lane:'postflop-heads-up',domain:domainForNodeFixture(hu),
    provider:async n=>{calls++;return {action:'CALL',evByAction:{FOLD:0,CALL:.3,RAISE:.1}};},
  }]);
  const huResult=await registry.provider(hu);
  assert.equal(huResult.oracles.length,1);
  assert.equal(calls,1);
  const multi=await registry.provider(node({activePlayers:3}));
  assert.equal(multi.oracles.length,0);
  assert.equal(calls,1);
  assert.ok(multi.routing[0].reason.includes('teacher_lane_mismatch'));
});

test('teacher registry rejects same lane when strategic profile is outside teacher domain',async()=>{
  const teacherNode=node({strategyProfile:'ranges-v1'});
  let calls=0;
  const registry=createTeacherRegistry([{
    teacherId:'profile-v1',family:'solver-a',lane:'postflop-heads-up',domain:domainForNodeFixture(teacherNode),
    provider:async()=>{calls++;return {action:'CALL',evByAction:{FOLD:0,CALL:.3}};},
  }]);
  const mismatch=node({strategyProfile:'ranges-v2'});
  const routed=await registry.provider(mismatch);
  assert.equal(routed.oracles.length,0);
  assert.equal(calls,0);
  assert.ok(routed.routing[0].reason.includes('domain_strategy_profile_mismatch'));
});

test('registry oracle provider exposes only domain-routed oracle rows',async()=>{
  const n=node();
  const registry=createTeacherRegistry([{
    teacherId:'solver-a',family:'family-a',lane:'postflop-heads-up',domain:domainForNodeFixture(n),
    provider:async()=>[{choiceId:'CALL',action:'CALL',confidence:.9,evByChoice:{FOLD:0,CALL:.2,'RAISE:8':.1}}],
  }]);
  const provider=createRegistryOracleProvider(registry);
  const rows=await provider(n);
  assert.equal(rows.length,1);
  assert.equal(rows[0].family,'family-a');
  assert.equal(rows[0].oracleId,'solver-a');
});

test('study accounting never calls planned or enumerated tickets certified studies',()=>{
  const accounting=buildStudyAccounting({
    plannedTickets:3317760,
    runs:[{
      ticketsSeen:100000,processedNodes:82000,studiedNodes:61000,blockedNodes:21000,nodeFactoryBlocked:10000,oracleProviderBlocked:8000,
      blockedByPhase:{UNDERSTANDING_PROOF:9000,TEACHER_CONSENSUS:12000},
      evSummary:{totalEvLossBB:4200,highImpactDecisions:5000,majorErrors:700,catastrophicErrors:90},
    }],
    artifactSummaries:[{rows:70000,indexed:65000,rejected:5000,families:['solver-a','solver-b']}],
  });
  assert.equal(accounting.plannedTickets,3317760);
  assert.equal(accounting.ticketsEnumerated,100000);
  assert.equal(accounting.certifiedStudies,61000);
  assert.equal(accounting.blockedOrUnstudied,39000);
  assert.match(accounting.honestClaim,/61000 certified studies from 100000 enumerated/);
  assert.equal(accounting.teacherCorpus.families.length,2);
  assert.equal(validateStudyAccounting(accounting).ok,true);
});
