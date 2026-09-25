import assert from 'node:assert/strict';
import {pushFoldGameFromPreflopContext,attachEffectiveStackToContext} from '../src/solver/pushfold-context.js';
import {solvePushFoldConsensus} from '../src/solver/pushfold-consensus.js';
import {buildBlindVsBlindPushFoldPacks} from '../src/strategy/pushfold-pack-builder.js';
import {clearPacks,registerPack} from '../src/strategy/pack-registry.js';
import {decideFromRegisteredPack} from '../src/decision/decision-engine.js';
import {equityAuditFixture} from '../src/math/equity-stability.js';

const SNAP='b'.repeat(64);
const OTHER='c'.repeat(64);
const individual={smallBlindBB:.5,anteBB:.125,anteType:'individual',playersDealt:8,forcedPreflopPotBB:2.5};
const gi=pushFoldGameFromPreflopContext(attachEffectiveStackToContext(individual,10));
assert.equal(gi.heroForcedBB,.625);assert.equal(gi.villainForcedBB,1.125);assert.equal(gi.deadMoneyBB,.75);assert.equal(gi.potBeforeBB,2.5);
const bba={smallBlindBB:.5,anteBB:1,anteType:'big_blind',playersDealt:8,forcedPreflopPotBB:2.5};
const gb=pushFoldGameFromPreflopContext(attachEffectiveStackToContext(bba,10));
assert.equal(gb.heroForcedBB,.5);assert.equal(gb.villainForcedBB,2);assert.equal(gb.deadMoneyBB,0);assert.equal(gb.potBeforeBB,2.5);
assert.throws(()=>pushFoldGameFromPreflopContext(attachEffectiveStackToContext({...individual,forcedPreflopPotBB:2.4},10)),/pot_mismatch/);

const hands=['AA','72o'];
const M={AA:{AA:.5,'72o':.82},'72o':{AA:.18,'72o':.5}};
let consensus=solvePushFoldConsensus({game:gi,equityMatrix:M,hands,regretIterations:12000,burnIn:1000,fictitiousIterations:8000,maxNashConv:.05,maxMeanFrequencyDiff:.08,maxFrequencyDiff:.2});
assert.equal(consensus.solverConsensus,true,JSON.stringify(consensus.agreement));
assert.equal(consensus.equityStable,false);
assert.equal(consensus.verificationReady,false);
assert.equal(consensus.recommendedCertification,'solver-derived');
assert.throws(()=>buildBlindVsBlindPushFoldPacks({consensus,preflopContext:individual,effectiveStackBB:10,equitySnapshotSha256:SNAP,promoteVerified:true,requireFull169:false}),/equity_stability_required/);

consensus=solvePushFoldConsensus({game:gi,equityMatrix:M,equityAudit:{...equityAuditFixture(true),snapshotShas:[SNAP]},hands,regretIterations:12000,burnIn:1000,fictitiousIterations:8000,maxNashConv:.05,maxMeanFrequencyDiff:.08,maxFrequencyDiff:.2});
assert.equal(consensus.verificationReady,true);
assert.equal(consensus.recommendedCertification,'solver-verified');
assert.throws(()=>buildBlindVsBlindPushFoldPacks({consensus,preflopContext:individual,effectiveStackBB:10}),/snapshot_sha256_required/);
assert.throws(()=>buildBlindVsBlindPushFoldPacks({consensus,preflopContext:individual,effectiveStackBB:10,equitySnapshotSha256:SNAP}),/incomplete_169/);
assert.throws(()=>buildBlindVsBlindPushFoldPacks({consensus,preflopContext:individual,effectiveStackBB:10,equitySnapshotSha256:OTHER,promoteVerified:true,requireFull169:false}),/snapshot_not_in_equity_audit/);

const derived=buildBlindVsBlindPushFoldPacks({consensus,preflopContext:individual,effectiveStackBB:10,equitySnapshotSha256:SNAP,requireFull169:false});
assert.equal(derived.sb.meta.certification,'solver-derived');
assert.equal(derived.bb.meta.certification,'solver-derived');
assert.equal(derived.sb.meta.snapshotSha256,SNAP);
assert.equal(derived.sb.meta.profileCoverage.complete169,false);
assert.equal(Object.keys(derived.sb.chart).length,2);
assert.equal(Object.keys(derived.bb.chart).length,2);
const verified=buildBlindVsBlindPushFoldPacks({consensus,preflopContext:individual,effectiveStackBB:10,equitySnapshotSha256:SNAP,promoteVerified:true,requireFull169:false});
assert.equal(verified.sb.meta.certification,'solver-verified');

clearPacks();registerPack(derived.sb.meta,derived.sb.chart);
const sbRaw={tableSize:8,playersDealt:8,heroPosition:'SB',smallBlind:500,bigBlind:1000,ante:125,anteType:'individual',heroStack:10000,villainStack:10000,pot:2500,toCall:0,history:[],legalActions:['FOLD','ALLIN'],hand:'AA',entrants:1000,remaining:700,paidSpots:150};
let r=decideFromRegisteredPack(sbRaw);
assert.equal(r.status,'STRATEGY_NOT_CERTIFIED');

clearPacks();registerPack(verified.sb.meta,verified.sb.chart);
r=decideFromRegisteredPack(sbRaw);
assert.equal(r.status,'DECISION');
assert(['FOLD','ALLIN'].includes(r.decision));

console.log('PASS — dual-solver consensus / equity-stability / snapshot-bound pack promotion gates');
