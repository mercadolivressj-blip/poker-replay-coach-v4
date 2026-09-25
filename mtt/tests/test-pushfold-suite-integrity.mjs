import assert from 'node:assert/strict';
import {all169} from '../src/core/hand-class.js';
import {sealPushFoldSuite,validatePushFoldSuite,pushFoldSuiteSha256} from '../src/strategy/pushfold-suite-integrity.js';
import {registerVerifiedPushFoldSuite} from '../src/strategy/pushfold-suite-loader.js';
import {clearPacks,registeredPackCount} from '../src/strategy/pack-registry.js';
import {decideFromRegisteredPack} from '../src/decision/decision-engine.js';

const SNAP='a'.repeat(64),ctx={smallBlindBB:.5,anteBB:.125,anteType:'individual',playersDealt:8,forcedPreflopPotBB:2.5};
function charts(){const sb={},bb={};for(const h of all169()){sb[h]=h==='AA'?{ALLIN:100}:{FOLD:100};bb[h]=h==='AA'?{CALL:100}:{FOLD:100}}return{sb,bb}}
const c=charts();
function meta(depth,side){return{game:'NLHE',format:'MTT',mode:'cEV',tableSize:8,stackDepthBB:depth,depthPolicy:'exact',node:'blind_vs_blind',heroPosition:side==='SB'?'SB':'BB',villainPosition:side==='SB'?'BB':'SB',source:'unit verified suite',sourceType:'internal-pushfold-solver',referenceDate:'2026-09-25',certification:'solver-verified',snapshotSha256:SNAP,actionSet:side==='SB'?['FOLD','ALLIN']:['FOLD','CALL'],contextPolicy:'exact-preflop-forced',preflopContext:{...ctx},profileCoverage:{complete169:true,missingCount:0}}}
function suiteBase(){
 const depths=[8,10],packs=[],reports=[];
 for(const d of depths){packs.push({depthBB:d,side:'SB',meta:meta(d,'SB'),chart:structuredClone(c.sb)},{depthBB:d,side:'BB',meta:meta(d,'BB'),chart:structuredClone(c.bb)});reports.push({depthBB:d,solverConsensus:true,equityStable:true,verificationReady:true,regretNashConv:.005,fictitiousNashConv:.006,agreement:{}})}
 return{schema:'ssj-mtt-pushfold-suite-v1',certification:'solver-verified',game:'NLHE',format:'MTT',mode:'cEV',node:'blind_vs_blind',tableSize:8,preflopContext:{...ctx},snapshotSha256:SNAP,equityAudit:{schema:'ssj-mtt-equity-snapshot-audit-v1',snapshotShas:[SNAP,'b'.repeat(64)],seeds:['a','b'],iterationsPerPair:20000,evaluatorVersion:'fast-v1',stability:{stable:true}},depths,reports,packs};
}

const sealed=sealPushFoldSuite(suiteBase());
assert.equal(sealed.suiteSha256.length,64);
assert.equal(sealed.suiteSha256,pushFoldSuiteSha256(sealed));
let v=validatePushFoldSuite(sealed);assert.equal(v.valid,true,JSON.stringify(v.errors));assert.equal(v.packCount,4);

const tampered=structuredClone(sealed);tampered.packs[0].chart.AA={FOLD:100};
v=validatePushFoldSuite(tampered);assert.equal(v.valid,false);assert(v.errors.includes('suite_sha_mismatch'));
const illegal=sealPushFoldSuite(suiteBase());illegal.packs[0].chart.KKs={CALL:100};
v=validatePushFoldSuite(illegal,{requireHash:false});assert.equal(v.valid,false);assert(v.errors.some(x=>x.includes('illegal_pack_action'))||v.errors.some(x=>x.includes('chart_not_exact_169')));
const dup=structuredClone(suiteBase());dup.packs[1]=structuredClone(dup.packs[0]);
v=validatePushFoldSuite(sealPushFoldSuite(dup));assert.equal(v.valid,false);assert(v.errors.some(x=>x.startsWith('duplicate_pack:')));
const unsorted=structuredClone(suiteBase());unsorted.depths=[10,8];
v=validatePushFoldSuite(sealPushFoldSuite(unsorted));assert.equal(v.valid,false);assert(v.errors.includes('depths_not_sorted_unique'));

clearPacks();const loaded=registerVerifiedPushFoldSuite(sealed,{clearExisting:true});
assert.equal(loaded.registered,4);assert.equal(registeredPackCount(),4);assert.equal(loaded.suiteSha256,sealed.suiteSha256);
const raw={tableSize:8,playersDealt:8,heroPosition:'SB',smallBlind:500,bigBlind:1000,ante:125,anteType:'individual',heroStack:10000,villainStack:10000,pot:2500,toCall:0,history:[],legalActions:['FOLD','ALLIN'],hand:'AA',entrants:1000,remaining:700,paidSpots:150};
const r=decideFromRegisteredPack(raw);assert.equal(r.status,'DECISION');assert.equal(r.decision,'ALLIN');assert.equal(r.pack.suiteSha256,sealed.suiteSha256);
assert.throws(()=>registerVerifiedPushFoldSuite(tampered),/suite_sha_mismatch/);

console.log('PASS — suite SHA256 / structure / action / loader integrity regressions');
