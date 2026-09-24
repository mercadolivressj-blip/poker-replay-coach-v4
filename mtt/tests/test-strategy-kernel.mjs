import assert from 'node:assert/strict';
import {normalizeHandClass,all169} from '../src/core/hand-class.js';
import {maskDistribution} from '../src/decision/legal-mask.js';
import {chooseMixed} from '../src/strategy/mixed.js';
import {registerPack,clearPacks,registeredPackCount,candidatePacks} from '../src/strategy/pack-registry.js';
import {decideFromRegisteredPack} from '../src/decision/decision-engine.js';
import {nearestTargetDepth,suggestedNonOverlappingBands} from '../src/strategy/depth-router.js';

assert.equal(normalizeHandClass('AsKh'),'AKo');
assert.equal(normalizeHandClass('AhKh'),'AKs');
assert.equal(normalizeHandClass('7c7d'),'77');
assert.equal(all169().length,169);

assert.deepEqual(maskDistribution({limp:50,raise:50},['CALL','RAISE']),{CALL:50,RAISE:50});
assert.deepEqual(maskDistribution({jam:100},['RAISE']),{RAISE:100});
assert.deepEqual(maskDistribution({fold:25,call:75,raise:10},['FOLD','CALL']),{FOLD:25,CALL:75});

const a=chooseMixed({CALL:50,RAISE:50},['CALL','RAISE'],'same-seed');
const b=chooseMixed({CALL:50,RAISE:50},['CALL','RAISE'],'same-seed');
assert.equal(a.action,b.action);

assert.deepEqual(nearestTargetDepth(23),{depthBB:25,distanceBB:2,exact:false});
const bands=suggestedNonOverlappingBands([10,20,30]);
assert.deepEqual(bands,[
 {stackDepthBB:10,minEffectiveBB:10,maxEffectiveBB:15},
 {stackDepthBB:20,minEffectiveBB:15,maxEffectiveBB:25},
 {stackDepthBB:30,minEffectiveBB:25,maxEffectiveBB:30}
]);

clearPacks();
const meta={
 game:'NLHE',format:'MTT',mode:'cEV',tableSize:8,stackDepthBB:24,depthPolicy:'exact',node:'unopened',heroPosition:'BTN',villainPosition:'*',
 source:'unit-test fixture',sourceType:'synthetic-test',referenceDate:'2026-09-24',certification:'reference-only',actionSet:['FOLD','CALL','RAISE']
};
assert.throws(()=>registerPack({...meta,source:''},{AKo:{RAISE:100}}),/strategy_pack_invalid:source_missing/);
assert.throws(()=>registerPack({...meta,stackDepthBB:null},{AKo:{RAISE:100}}),/stack_depth_bb_missing_or_invalid/);
registerPack(meta,{AKo:{RAISE:100},A5s:{CALL:50,RAISE:50}});
assert.equal(registeredPackCount(),1);

const base={tableSize:8,heroPosition:'BTN',smallBlind:500,bigBlind:1000,ante:125,playersDealt:8,heroStack:24000,villainStack:30000,pot:2500,toCall:0,entrants:1000,remaining:700,paidSpots:150,history:[],legalActions:['FOLD','CALL','RAISE']};
let r=decideFromRegisteredPack({...base,hand:'AKo'});
assert.equal(r.status,'DECISION');
assert.equal(r.decision,'RAISE');
assert.equal(r.pack.source,'unit-test fixture');
assert.equal(r.depth.anchorBB,24);

r=decideFromRegisteredPack({...base,hand:'A5s'},{decisionKey:'mtt-mix-1'});
assert.equal(r.status,'DECISION');
assert(['CALL','RAISE'].includes(r.decision));
const r2=decideFromRegisteredPack({...base,hand:'A5s'},{decisionKey:'mtt-mix-1'});
assert.equal(r.decision,r2.decision);

r=decideFromRegisteredPack({...base,hand:'Q7o'});
assert.equal(r.status,'OUT_OF_COVERAGE');
assert.equal(r.decision,null);

r=decideFromRegisteredPack({...base,heroStack:23900,villainStack:30000,hand:'AKo'});
assert.equal(r.status,'OUT_OF_COVERAGE');

const bandMeta={...meta,heroPosition:'CO',stackDepthBB:20,depthPolicy:'band',minEffectiveBB:17,maxEffectiveBB:22,certification:'solver-derived'};
registerPack(bandMeta,{AKo:{RAISE:100}});
assert.equal(candidatePacks({game:'NLHE',format:'MTT',mode:'cEV',tableSize:8,effectiveBB:21,node:'unopened',heroPosition:'CO',villainPosition:'*'}).length,1);
const bandBase={...base,heroPosition:'CO',heroStack:21000,villainStack:30000,hand:'AKo'};
r=decideFromRegisteredPack(bandBase);
assert.equal(r.status,'DECISION');
assert.equal(r.pack.stackDepthBB,20);

console.log('PASS — MTT strategy kernel depth-aware regressions');
