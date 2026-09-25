import assert from 'node:assert/strict';
import {ARCHETYPES} from '../src/opponents.mjs';
import {createPlayerModel,observe,addHand,profileSnapshot,exploitWeight} from '../src/player-model.mjs';
import {createRangeBelief,updateBelief,applyHeroBlockers,rangeSummary} from '../src/range-belief.mjs';
import {auditDecision,aggregateRegret} from '../src/regret.mjs';
import {terminalDecisionGate,exploitGate} from '../src/confidence-gate.mjs';
import {compareLearning} from '../src/simulator.mjs';

// 1) Strong archetype library exists and contains materially different opponents.
assert(ARCHETYPES.BALANCED_REG && ARCHETYPES.AGGRO_REG && ARCHETYPES.TIGHT_REG);
assert(ARCHETYPES.AGGRO_REG.riverBluff > ARCHETYPES.TIGHT_REG.riverBluff);
assert(ARCHETYPES.AGGRO_REG.threeBet > ARCHETYPES.TIGHT_REG.threeBet);

// 2) Player model must not exploit tiny samples.
let pm=createPlayerModel();
for(let i=0;i<8;i++){addHand(pm);observe(pm,'riverBluff',i<5);}
assert.equal(profileSnapshot(pm).trusted,false);
assert.equal(exploitWeight(pm),0);
assert.equal(exploitGate({handsSeen:8,exploitWeight:0}).allowed,false);

// 3) With meaningful observations, confidence can rise gradually rather than snap-classifying.
for(let i=0;i<160;i++){addHand(pm);observe(pm,'riverBluff',i%2===0);}
assert(profileSnapshot(pm).handsSeen>=160);
assert(exploitWeight(pm)>0);

// 4) River large bet on a completed flush should polarize range and reduce medium showdown.
let rb=createRangeBelief();
const before=rangeSummary(rb);
updateBelief(rb,{street:'flop',action:'bet',sizePct:30,boardFeatures:{flushCompleted:false}});
updateBelief(rb,{street:'turn',action:'check',boardFeatures:{flushCompleted:false}});
updateBelief(rb,{street:'river',action:'bet',sizePct:88,boardFeatures:{flushCompleted:true}});
const after=rangeSummary(rb);
assert(after.NUTS>before.NUTS);
assert(after.MEDIUM_SHOWDOWN<before.MEDIUM_SHOWDOWN);
assert(after.polarized || (after.NUTS+after.BLUFF_CANDIDATE)>(before.NUTS+before.BLUFF_CANDIDATE));

// 5) Blockers must actually remove plausible value/bluff weight and renormalize.
const nutsBefore=rb.weights.NUTS;
applyHeroBlockers(rb,{blocksNuts:.5});
assert(rb.weights.NUTS<nutsBefore);
const sum=Object.values(rb.weights).reduce((a,b)=>a+b,0);
assert(Math.abs(sum-1)<1e-9);

// 6) Regret auditor identifies wrong expensive action rather than judging by result.
const a=auditDecision({selectedAction:'RAISE',actionEVs:{FOLD:0,CALL:22.5,RAISE:7.0}});
assert.equal(a.auditable,true);
assert.equal(a.best.action,'CALL');
assert(a.regretBB===15.5 && a.severe);
const agg=aggregateRegret([a,auditDecision({selectedAction:'CALL',actionEVs:{FOLD:0,CALL:2,RAISE:1.5}})]);
assert.equal(agg.decisions,2);
assert(agg.avgRegretBB>7);

// 7) K3-like terminal guard: two pair, completed flush, facing large bet, oracle disagrees with raise.
const k3Gate=terminalDecisionGate({
  street:'river',selectedAction:'RAISE',rangeConfidence:.70,
  oracleAvailable:true,oracleAgreement:false,
  policyAvailable:true,policyAgreement:false,
  facingLargeBet:true,heroHandTier:2,boardCompletesDraw:true
});
assert.equal(k3Gate.allowed,false);
assert(k3Gate.reasons.includes('terminal_aggression_oracle_conflict'));

// 8) Strong terminal aggression can pass only with independent support and confidence.
const valueGate=terminalDecisionGate({
  street:'river',selectedAction:'RAISE',rangeConfidence:.90,
  oracleAvailable:true,oracleAgreement:true,
  policyAvailable:true,policyAgreement:true,
  facingLargeBet:true,heroHandTier:4,boardCompletesDraw:true,
  playerExploitWeight:.3
});
assert.equal(valueGate.allowed,true);

// 9) Deterministic player learning should improve directionally with sample size.
const learn=compareLearning({archetype:'AGGRO_REG',seed:42,shortHands:20,longHands:600});
assert(learn.longError<learn.shortError);
assert(learn.long.snapshot.trusted);

console.log('PASS — Cash Pro Lab V0.1 foundation regressions');
