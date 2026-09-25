import assert from 'node:assert/strict';
import {scoreFive,evaluateSeven,compareHoldem,exactEquityVsHand,deck} from '../src/holdem-evaluator.mjs';
import {createExplicitComboRange,normalizedComboProbabilities} from '../src/combo-range.mjs';
import {drawCompletion,heroSuitBlockers,exactWeightedRiverEquity,summarizeMadeHands} from '../src/river-range-audit.mjs';
import {applyRiverActionEvidence,riverLineSummary,riverComboFeatures} from '../src/river-line-model.mjs';
import {riverCallAudit,aggressionDisagreementGate} from '../src/river-ev-audit.mjs';

// Ported evaluator keeps the old correctness regressions.
assert.equal(deck().length,52);
assert.equal(new Set(deck()).size,52);
assert.equal(scoreFive(['Ah','Kh','Qh','Jh','Th']).name,'straight-flush');
assert.equal(scoreFive(['As','Ad','Ac','Kd','Kh']).name,'full-house');
assert.equal(scoreFive(['2c','3d','4h','5s','Ah']).name,'straight');
assert.equal(evaluateSeven(['Ah','Kh','Qh','Jh','9h','Tc','8d']).name,'flush');
assert.equal(compareHoldem(['As','Ad'],['Ks','Kd'],['2c','3c','4d','7h','9s']).result,1);
assert.equal(exactEquityVsHand(['2c','3d'],['4c','5d'],['Ah','Kh','Qh','Jh','Th']).equity,.5);

// Exact reconstruction of the critical K3 river board.
const hero=['Ks','3s'];
const turn=['4s','2h','Kh','7d'];
const board=[...turn,'3h'];
const qhth=riverComboFeatures('QhTh',board);
assert.equal(qhth.madeName,'flush');
assert.equal(qhth.flushOrBetter,true);
const exact=compareHoldem(hero,['Qh','Th'],board);
assert.equal(exact.result,-1);
assert.equal(exact.hero.name,'two-pair');
assert.equal(exact.villain.name,'flush');

const completion=drawCompletion(turn,board);
assert.equal(completion.flushCompleted,true);
assert.equal(completion.dominantSuit,'h');
const blocker=heroSuitBlockers(hero,board);
assert.equal(blocker.count,0);
assert.equal(blocker.nutFlushBlocker,false);
assert.equal(blocker.highFlushBlocker,false);

// Explicit lab range: enough value AND bluffs/showdown hands to audit call mathematics.
// This is a regression fixture, not a population claim.
const prior=createExplicitComboRange({
  source:'k3-river-regression-fixture',status:'lab-only',depthBb:36,position:'BTN',node:'SRP_BTN_VS_BB',
  combos:[
    {combo:'QhTh',weight:1,origin:'made-flush'},
    {combo:'Ah5h',weight:.8,origin:'made-flush'},
    {combo:'Jh9h',weight:.7,origin:'made-flush'},
    {combo:'6c5c',weight:.5,origin:'straight'},
    {combo:'KcQc',weight:1,origin:'one-pair-showdown'},
    {combo:'KdQd',weight:.8,origin:'one-pair-showdown'},
    {combo:'QcJc',weight:1,origin:'air-bluff'},
    {combo:'QdJd',weight:1,origin:'air-bluff'},
    {combo:'Tc9c',weight:.9,origin:'air-bluff'},
    {combo:'Td9d',weight:.9,origin:'air-bluff'}
  ]
});

const before=riverLineSummary(prior,{board,hero});
const afterRange=applyRiverActionEvidence(prior,{
  board,hero,action:'BET',sizePct:87.9,flushCompleted:true,turnCheckedBack:true
});
const after=riverLineSummary(afterRange,{board,hero});
assert(after.flushOrBetter>before.flushOrBetter);
assert(after.twoPair<=before.twoPair+1e-12);

const eq=exactWeightedRiverEquity({hero,board,villainRange:afterRange});
assert(eq.liveCombos===10);
assert(eq.equity>0 && eq.equity<1);
const made=summarizeMadeHands(eq);
assert((made.flush||0)>0);

const call=riverCallAudit({hero,board,villainRange:afterRange,potAfterBet:33.81,toCall:15.82});
assert.equal(call.action,'CALL');
assert(call.requiredEquity>0.31 && call.requiredEquity<0.33);
assert(call.callEv>0);

// A lab-only range cannot authorize an aggressive override, especially against an independent CALL audit.
const gate=aggressionDisagreementGate({selectedAction:'RAISE',callAudit:call,independentAction:'CALL',rangeStatus:afterRange.status});
assert.equal(gate.allowed,false);
assert(gate.reasons.includes('independent_ev_disagrees_with_aggression'));
assert(gate.reasons.includes('range_not_certified_for_aggressive_override'));

// Probabilities remain normalized after line reweighting.
const ps=[...normalizedComboProbabilities(afterRange).values()].reduce((a,b)=>a+b,0);
assert(Math.abs(ps-1)<1e-12);

console.log('PASS — Cash Pro Lab V0.3 exact river combo-line / K3 regression');
