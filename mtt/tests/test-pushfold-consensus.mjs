import assert from 'node:assert/strict';
import {pushFoldGameFromPreflopContext,attachEffectiveStackToContext} from '../src/solver/pushfold-context.js';
import {solvePushFoldConsensus} from '../src/solver/pushfold-consensus.js';
import {buildBlindVsBlindPushFoldPacks} from '../src/strategy/pushfold-pack-builder.js';
import {clearPacks,registerPack} from '../src/strategy/pack-registry.js';
import {decideFromRegisteredPack} from '../src/decision/decision-engine.js';

const individual={smallBlindBB:.5,anteBB:.125,anteType:'individual',playersDealt:8,forcedPreflopPotBB:2.5};
const gi=pushFoldGameFromPreflopContext(attachEffectiveStackToContext(individual,10));
assert.equal(gi.heroForcedBB,.625);assert.equal(gi.villainForcedBB,1.125);assert.equal(gi.deadMoneyBB,.75);assert.equal(gi.potBeforeBB,2.5);
const bba={smallBlindBB:.5,anteBB:1,anteType:'big_blind',playersDealt:8,forcedPreflopPotBB:2.5};
const gb=pushFoldGameFromPreflopContext(attachEffectiveStackToContext(bba,10));
assert.equal(gb.heroForcedBB,.5);assert.equal(gb.villainForcedBB,2);assert.equal(gb.deadMoneyBB,0);assert.equal(gb.potBeforeBB,2.5);
assert.throws(()=>pushFoldGameFromPreflopContext(attachEffectiveStackToContext({...individual,forcedPreflopPotBB:2.4},10)),/pot_mismatch/);

const hands=['AA','72o'];
const M={AA:{AA:.5,'72o':.82},'72o':{AA:.18,'72o':.5}};
const consensus=solvePushFoldConsensus({game:gi,equityMatrix:M,hands,regretIterations:12000,burnIn:1000,fictitiousIterations:8000,maxNashConv:.05,maxMeanFrequencyDiff:.08,maxFrequencyDiff:.2});
assert.equal(consensus.solverConsensus,true,JSON.stringify(consensus.agreement));
assert.equal(consensus.recommendedCertification,'solver-verified');

const derived=buildBlindVsBlindPushFoldPacks({consensus,preflopContext:individual,effectiveStackBB:10});
assert.equal(derived.sb.meta.certification,'solver-derived');
assert.equal(derived.bb.meta.certification,'solver-derived');
assert.equal(Object.keys(derived.sb.chart).length,169);
assert.equal(Object.keys(derived.bb.chart).length,169);
const verified=buildBlindVsBlindPushFoldPacks({consensus,preflopContext:individual,effectiveStackBB:10,promoteVerified:true});
assert.equal(verified.sb.meta.certification,'solver-verified');

// Default decision gate must block a solver-derived pack.
clearPacks();registerPack(derived.sb.meta,derived.sb.chart);
const sbRaw={tableSize:8,playersDealt:8,heroPosition:'SB',smallBlind:500,bigBlind:1000,ante:125,anteType:'individual',heroStack:10000,villainStack:10000,pot:2500,toCall:0,history:[],legalActions:['FOLD','ALLIN'],hand:'AA',entrants:1000,remaining:700,paidSpots:150};
let r=decideFromRegisteredPack(sbRaw);
assert.equal(r.status,'STRATEGY_NOT_CERTIFIED');

// Promotion only after consensus explicitly unlocks the normal gate.
clearPacks();registerPack(verified.sb.meta,verified.sb.chart);
r=decideFromRegisteredPack(sbRaw);
assert.equal(r.status,'DECISION');
assert(['FOLD','ALLIN'].includes(r.decision));

console.log('PASS — dual-solver consensus / ante allocation / pack-promotion gates');
