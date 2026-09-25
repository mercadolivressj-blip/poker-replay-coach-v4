import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode, proveDecisionNode } from '../src/cash-pro-lab/decision-node.js';
import { buildOracleConsensus } from '../src/cash-pro-lab/oracle-consensus.js';
import { auditDecisionEV } from '../src/cash-pro-lab/ev-auditor.js';
import { evaluateCashDecision } from '../src/cash-pro-lab/cash-pro-lab.js';
import { certifyChallenger } from '../src/cash-pro-lab/promotion-gate.js';

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
  const result=await evaluateCashDecision({
    node:riverNode(),
    student:async()=>({action:'ALLIN'}),
    oracles:[oracleA,oracleB],
  });
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.phase,'STUDENT_LEGALITY');
});

test('full lab produces a studied lesson only after proof and teacher consensus',async()=>{
  const result=await evaluateCashDecision({
    node:riverNode(),
    student:async()=>({action:'CALL',engine:'fixture-student'}),
    oracles:[oracleA,oracleB],
  });
  assert.equal(result.status,'STUDIED');
  assert.equal(result.phase,'COMPLETE');
  assert.equal(result.audit.bestAction,'CALL');
  assert.equal(result.audit.evLossBB,0);
  assert.equal(result.lesson.needsReview,true);
});

test('challenger never auto-promotes and is blocked by safety violations',()=>{
  const champion=[{fingerprint:'a',blocked:false,evLossBB:0.5,highImpact:true,severity:'material',exactMatch:false}];
  const challenger=[{fingerprint:'a',blocked:false,evLossBB:0.1,highImpact:true,severity:'material',exactMatch:true}];
  const result=certifyChallenger({
    championAudits:champion,challengerAudits:challenger,
    violations:{illegalActions:1},options:{minNodes:1},
  });
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
