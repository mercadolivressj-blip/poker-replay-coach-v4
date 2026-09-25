import assert from 'node:assert/strict';
import {all169} from '../src/core/hand-class.js';
import {buildEquityMatrixSnapshot} from '../src/math/equity-matrix-snapshot.js';
import {validateProductionEquityEvidence,buildVerifiedPushFoldSuiteFromConsensus} from '../src/strategy/pushfold-suite-builder.js';
import {clearPacks,registerPack} from '../src/strategy/pack-registry.js';
import {decideFromRegisteredPack} from '../src/decision/decision-engine.js';

const hands=all169();
const matrix={};for(const a of hands){matrix[a]={};for(const b of hands)matrix[a][b]=.5}
const snapshot=buildEquityMatrixSnapshot({matrix,hands,seed:'suite-prod-a',iterationsPerPair:20000,evaluatorVersion:'fast-holdem-evaluator-v1'});
const audit={schema:'ssj-mtt-equity-snapshot-audit-v1',stable:true,snapshotCount:2,snapshotShas:[snapshot.sha256,'c'.repeat(64)],seeds:['suite-prod-a','suite-prod-b'],iterationsPerPair:20000,evaluatorVersion:'fast-holdem-evaluator-v1',stability:{stable:true,meanPairRange:.001,maxPairRange:.004,checks:{meanStable:true,maxStable:true}}};
let ev=validateProductionEquityEvidence({snapshot,audit});
assert.equal(ev.valid,true,JSON.stringify(ev));assert.equal(ev.full169,true);
assert.equal(validateProductionEquityEvidence({snapshot,audit:{...audit,stable:false}}).valid,false);
assert.equal(validateProductionEquityEvidence({snapshot,audit:{...audit,snapshotShas:['d'.repeat(64)]}}).valid,false);

function consensus(depth){
 const shoveStrategy={},callStrategy={};for(const h of hands){shoveStrategy[h]=h==='AA'?1:.25;callStrategy[h]=h==='AA'?1:.10}
 return{version:'pushfold-consensus-v2',solverConsensus:true,equityStable:true,verificationReady:true,equityAudit:audit,regret:{nashConv:.005,shoveStrategy,callStrategy},fictitious:{nashConv:.006,shoveStrategy:{...shoveStrategy},callStrategy:{...callStrategy}},agreement:{shove:{meanAbsDiff:.001,maxAbsDiff:.01},call:{meanAbsDiff:.001,maxAbsDiff:.01}},checks:{regretConverged:true,fictitiousConverged:true,shoveMeanAgreement:true,callMeanAgreement:true,shoveMaxAgreement:true,callMaxAgreement:true},depth};
}
const context={smallBlindBB:.5,anteBB:.125,anteType:'individual',playersDealt:8,forcedPreflopPotBB:2.5};
const suite=buildVerifiedPushFoldSuiteFromConsensus({snapshot,audit,preflopContext:context,depths:[10,8],depthProfiles:{8:consensus(8),10:consensus(10)}});
assert.equal(suite.schema,'ssj-mtt-pushfold-suite-v1');assert.equal(suite.certification,'solver-verified');assert.deepEqual(suite.depths,[8,10]);assert.equal(suite.packs.length,4);assert(suite.packs.every(p=>Object.keys(p.chart).length===169));assert(suite.packs.every(p=>p.meta.snapshotSha256===snapshot.sha256));

const broken=consensus(8);broken.verificationReady=false;
assert.throws(()=>buildVerifiedPushFoldSuiteFromConsensus({snapshot,audit,preflopContext:context,depths:[8],depthProfiles:{8:broken}}),/depth_not_verified/);
const mismatch=consensus(8);mismatch.equityAudit={...audit,snapshotShas:['e'.repeat(64)]};
assert.throws(()=>buildVerifiedPushFoldSuiteFromConsensus({snapshot,audit,preflopContext:context,depths:[8],depthProfiles:{8:mismatch}}),/consensus_snapshot_mismatch/);

clearPacks();for(const p of suite.packs.filter(x=>x.depthBB===10))registerPack(p.meta,p.chart);
const raw={tableSize:8,playersDealt:8,heroPosition:'SB',smallBlind:500,bigBlind:1000,ante:125,anteType:'individual',heroStack:10000,villainStack:10000,pot:2500,toCall:0,history:[],legalActions:['FOLD','ALLIN'],hand:'AA',entrants:1000,remaining:700,paidSpots:150};
const decision=decideFromRegisteredPack(raw);
assert.equal(decision.status,'DECISION');assert.equal(decision.decision,'ALLIN');assert.equal(decision.pack.certification,'solver-verified');

console.log('PASS — production verified push-fold suite evidence / depth / registry regressions');
