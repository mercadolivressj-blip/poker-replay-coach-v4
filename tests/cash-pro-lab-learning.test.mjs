import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActiveLearningQueue } from '../src/cash-pro-lab/active-learning.js';
import { certifyPairedHoldout } from '../src/cash-pro-lab/holdout-certifier.js';

const row=({split='train',fp='x',loss=.1,high=false,severity='material',status='STUDIED',phase=null}={})=>({
  status,phase,
  ticket:{split,axes:{street:'river',heroPosition:'BB',effectiveStackBB:100,activePlayers:2,potClass:'large',facingClass:'bet-large',textureClass:'dynamic',initiative:'villain'}},
  node:{fingerprint:fp,decisionId:fp},
  proof:{highImpact:high},
  audit:status==='STUDIED'?{fingerprint:fp,evLossBB:loss,highImpact:high,severity,consensusConfidence:.9}:null,
});

test('active learning consumes train evidence only and ranks expensive mistakes first',()=>{
  const out=buildActiveLearningQueue([
    row({split:'holdout',fp:'holdout-catastrophe',loss:20,high:true,severity:'catastrophic'}),
    row({split:'train',fp:'cheap',loss:.05,severity:'small'}),
    row({split:'train',fp:'expensive',loss:3,high:true,severity:'catastrophic'}),
  ]);
  assert.equal(out.holdoutConsumed,false);
  assert.equal(out.trainEvaluations,2);
  assert.equal(out.queue.length,2);
  assert.equal(out.queue[0].fingerprint,'expensive');
  assert.ok(out.queue.every(x=>x.sourceSplit==='train'));
  assert.ok(!out.queue.some(x=>x.fingerprint==='holdout-catastrophe'));
});

test('active learning prioritizes illegal or unproven train decisions without using holdout',()=>{
  const out=buildActiveLearningQueue([
    row({split:'train',fp:'illegal',status:'BLOCKED',phase:'STUDENT_LEGALITY',high:true}),
    row({split:'train',fp:'proof',status:'BLOCKED',phase:'UNDERSTANDING_PROOF'}),
    row({split:'dev',fp:'dev',loss:100,high:true,severity:'catastrophic'}),
  ]);
  assert.equal(out.queue[0].fingerprint,'illegal');
  assert.ok(out.queue.some(x=>x.fingerprint==='proof'));
  assert.ok(!out.queue.some(x=>x.fingerprint==='dev'));
});

function holdoutEval(fp,loss,{high=false,split='holdout'}={}){
  return {
    status:'STUDIED',ticket:{split},node:{fingerprint:fp},
    audit:{fingerprint:fp,evLossBB:loss,highImpact:high,severity:loss>=2?'catastrophic':'material'},
  };
}

test('paired holdout can make a challenger eligible for human review but never auto-promotes',()=>{
  const champion=[
    holdoutEval('a',1,{high:true}),holdoutEval('b',.8,{high:true}),holdoutEval('c',.6),holdoutEval('d',.4),
  ];
  const challenger=[
    holdoutEval('a',.4,{high:true}),holdoutEval('b',.3,{high:true}),holdoutEval('c',.2),holdoutEval('d',.1),
  ];
  const out=certifyPairedHoldout({championEvaluations:champion,challengerEvaluations:challenger,options:{minNodes:4,minHighImpactNodes:2,requireCI95:false,maxP95RegressionBB:0}});
  assert.equal(out.eligibleForHumanReview,true);
  assert.equal(out.autoPromote,false);
  assert.ok(out.avgDeltaBB<0);
  assert.equal(out.worse,0);
});

test('paired holdout rejects contamination by train evidence',()=>{
  const champion=[holdoutEval('a',1),holdoutEval('train-x',1,{split:'train'})];
  const challenger=[holdoutEval('a',.5),holdoutEval('train-x',.1,{split:'train'})];
  const out=certifyPairedHoldout({championEvaluations:champion,challengerEvaluations:challenger,options:{minNodes:1,minHighImpactNodes:0,requireCI95:false}});
  assert.equal(out.eligibleForHumanReview,false);
  assert.ok(out.reasons.includes('non_holdout_evidence_supplied'));
});

test('paired holdout rejects average regression and safety violations',()=>{
  const champion=[holdoutEval('a',.2,{high:true})];
  const challenger=[holdoutEval('a',1,{high:true})];
  const out=certifyPairedHoldout({
    championEvaluations:champion,challengerEvaluations:challenger,
    violations:{illegalActions:1,holdoutLeakage:1},
    options:{minNodes:1,minHighImpactNodes:1,requireCI95:false,maxP95RegressionBB:2},
  });
  assert.equal(out.eligibleForHumanReview,false);
  assert.ok(out.reasons.includes('mean_holdout_ev_regression'));
  assert.ok(out.reasons.includes('illegal_action_violation'));
  assert.ok(out.reasons.includes('holdout_leakage_violation'));
});
