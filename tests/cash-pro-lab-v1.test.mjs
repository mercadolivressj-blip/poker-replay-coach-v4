import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode, proveDecisionNode } from '../src/cash-pro-lab/decision-node.js';
import { buildOracleConsensus } from '../src/cash-pro-lab/oracle-consensus.js';
import { auditDecisionEV } from '../src/cash-pro-lab/ev-auditor.js';
import { evaluateCashDecision } from '../src/cash-pro-lab/cash-pro-lab.js';
import { certifyChallenger } from '../src/cash-pro-lab/promotion-gate.js';
import { telemetryTurnsToDecisionNodes } from '../src/cash-pro-lab/telemetry-adapter.js';
import { createCashBrainStudent } from '../src/cash-pro-lab/student-adapter.js';

const evidence=(source='solver-fixture',confidence=1)=>Object.fromEntries(
  ['heroCards','board','heroPosition','effectiveStackBB','potBB','toCallBB','activePlayers','legalActions','actionHistory']
    .map(field=>[field,{source,confidence}])
);

function riverNode(overrides={}){
  return createDecisionNode({
    handId:'fixture-1',decisionId:'river-1',heroCards:['Kh','3s'],board:['Kd','4s','2h','7c','3h'],
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
    evidence:evidence(),
    ...overrides,
  });
}

const oracleA={oracleId:'solver-a',source:'solver',action:'CALL',confidence:0.95,domainVerified:true,evByAction:{FOLD:0,CALL:1.20,RAISE:-2.80}};
const oracleB={oracleId:'solver-b',source:'benchmark',action:'CALL',confidence:0.90,domainVerified:true,evByAction:{FOLD:0,CALL:1.00,RAISE:-2.40}};

test('understanding proof blocks a decision when one critical evidence field is missing',()=>{
  const ev=evidence();delete ev.toCallBB;
  const proof=proveDecisionNode(riverNode({evidence:ev}));
  assert.equal(proof.ok,false);
  assert.ok(proof.errors.includes('evidence_missing:toCallBB'));
});

test('high-impact river cannot be taught by a single oracle',()=>{
  const node=riverNode();
  const proof=proveDecisionNode(node);
  assert.equal(proof.ok,true);
  assert.equal(proof.highImpact,true);
  const consensus=buildOracleConsensus(node,[oracleA]);
  assert.equal(consensus.blocked,true);
  assert.equal(consensus.reason,'insufficient_verified_oracles');
  assert.equal(consensus.required,2);
});

test('domain-unverified oracle is rejected even when it strongly agrees',()=>{
  const node=riverNode();
  const bad={...oracleB,oracleId:'wrong-stack',domainVerified:false,confidence:1};
  const consensus=buildOracleConsensus(node,[oracleA,bad]);
  assert.equal(consensus.blocked,true);
  assert.ok(consensus.rejected.some(r=>r.oracleId==='wrong-stack'&&r.reasons.includes('domain_unverified')));
});

test('EV auditor measures costly disagreement instead of accuracy only',()=>{
  const node=riverNode();
  const consensus=buildOracleConsensus(node,[oracleA,oracleB]);
  assert.equal(consensus.blocked,false);
  assert.equal(consensus.bestAction,'CALL');
  const audit=auditDecisionEV(node,{action:'RAISE'},consensus);
  assert.equal(audit.blocked,false);
  assert.equal(audit.studentAction,'RAISE');
  assert.ok(audit.evLossBB>3.5);
  assert.equal(audit.severity,'catastrophic');
});

test('full lab blocks an illegal student action before teacher comparison',async()=>{
  const result=await evaluateCashDecision({node:riverNode(),student:async()=>({action:'ALLIN'}),oracles:[oracleA,oracleB]});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.phase,'STUDENT_LEGALITY');
});

test('full lab produces a studied lesson only after proof and teacher consensus',async()=>{
  const result=await evaluateCashDecision({node:riverNode(),student:async()=>({action:'CALL',engine:'fixture-student'}),oracles:[oracleA,oracleB]});
  assert.equal(result.status,'STUDIED');
  assert.equal(result.phase,'COMPLETE');
  assert.equal(result.audit.bestAction,'CALL');
  assert.equal(result.audit.evLossBB,0);
  assert.equal(result.lesson.needsReview,true);
});

test('challenger never auto-promotes and is blocked by safety violations',()=>{
  const champion=[{fingerprint:'a',blocked:false,evLossBB:0.5,highImpact:true,severity:'material',exactMatch:false}];
  const challenger=[{fingerprint:'a',blocked:false,evLossBB:0.1,highImpact:true,severity:'material',exactMatch:true}];
  const result=certifyChallenger({championAudits:champion,challengerAudits:challenger,violations:{illegalActions:1},options:{minNodes:1}});
  assert.equal(result.eligibleForHumanReview,false);
  assert.equal(result.autoPromote,false);
  assert.ok(result.reasons.includes('illegal_action_violation'));
});

test('clean challenger can only become eligible for human review, never auto-promoted',()=>{
  const champion=[{fingerprint:'a',blocked:false,evLossBB:0.5,highImpact:true,severity:'material',exactMatch:false}];
  const challenger=[{fingerprint:'a',blocked:false,evLossBB:0.1,highImpact:true,severity:'material',exactMatch:true}];
  const result=certifyChallenger({championAudits:champion,challengerAudits:challenger,options:{minNodes:1}});
  assert.equal(result.eligibleForHumanReview,true);
  assert.equal(result.autoPromote,false);
});

function telemetryFixture(validated=true){
  const turn={handId:7,epoch:3,street:'river',mediaTime:12.5,snapshot:{state:{heroCards:['Kh','3s'],board:['Kd','4s','2h','7c','3h'],heroPosition:'BB',heroStack:80,pot:60,toCall:40,legalActions:['FOLD','CALL','RAISE'],activePlayers:2}}};
  if(validated) turn.validation={ok:true};
  return {turns:[turn],decisions:[],events:[{type:'action',handId:7,mediaTime:10.0,street:'river',seatId:'right-high',action:'BET',amount:40,confidence:0.99}]};
}

test('telemetry adapter refuses to certify a turn without runtime validation evidence',()=>{
  const [row]=telemetryTurnsToDecisionNodes(telemetryFixture(false),{bigBlind:1,rakeProfile:'100z-high-rake'});
  assert.equal(row.runtimeValidated,false);
  assert.ok(row.adapterErrors.includes('runtime_validation_missing'));
  assert.equal(row.proof.ok,false);
  assert.ok(row.proof.errors.some(e=>e.startsWith('evidence_low_confidence:')));
});

test('validated telemetry can become a proved decision node without guessing missing money units',()=>{
  const [row]=telemetryTurnsToDecisionNodes(telemetryFixture(true),{bigBlind:1,rakeProfile:'100z-high-rake'});
  assert.equal(row.runtimeValidated,true);
  assert.equal(row.node.potBB,60);
  assert.equal(row.node.toCallBB,40);
  assert.equal(row.node.effectiveStackBB,80);
  assert.equal(row.proof.ok,true);
});

test('telemetry adapter blocks when big blind is unavailable instead of inventing BB conversion',()=>{
  const [row]=telemetryTurnsToDecisionNodes(telemetryFixture(true),{rakeProfile:'100z-high-rake'});
  assert.ok(row.adapterErrors.includes('big_blind_missing'));
  assert.equal(row.proof.ok,false);
  assert.ok(row.proof.errors.includes('effective_stack_missing'));
});

test('cash brain student receives canonical BB state and structured external ledger',async()=>{
  let seen=null;
  const student=createCashBrainStudent({brain:(state,context)=>{seen={state,context};return{actionCode:'CALL',confidence:0.7,engine:'fake-brain',reason:'fixture'};}});
  const out=await student(riverNode());
  assert.equal(out.blocked,false);
  assert.equal(out.action,'CALL');
  assert.equal(seen.state.pot,60);
  assert.equal(seen.state.toCall,40);
  assert.equal(seen.context.ledger.actions.length,10);
  assert.equal(seen.context.ledger.preflopAggressor,'BTN');
});

test('student adapter blocks mixed strategy when the brain does not expose weights',async()=>{
  const student=createCashBrainStudent({brain:()=>({actionCode:'MIXED',mixed:true,mixedActionCodes:['CALL','FOLD'],confidence:0.5})});
  const out=await student(riverNode());
  assert.equal(out.blocked,true);
  assert.equal(out.reason,'mixed_strategy_weights_missing');
});

test('explicit mixed strategy is scored by expected EV, not guessed as one action',async()=>{
  const result=await evaluateCashDecision({
    node:riverNode(),
    student:async()=>({actionMix:{CALL:0.75,FOLD:0.25},engine:'weighted-fixture'}),
    oracles:[oracleA,oracleB],
  });
  assert.equal(result.status,'STUDIED');
  assert.equal(result.audit.studentAction,'MIXED');
  assert.ok(result.audit.evLossBB>0.20&&result.audit.evLossBB<0.40);
});

test('malformed mixed weights are blocked instead of normalized silently',async()=>{
  const result=await evaluateCashDecision({
    node:riverNode(),
    student:async()=>({actionMix:{CALL:0.4,FOLD:0.4}}),
    oracles:[oracleA,oracleB],
  });
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.phase,'STUDENT_LEGALITY');
});
