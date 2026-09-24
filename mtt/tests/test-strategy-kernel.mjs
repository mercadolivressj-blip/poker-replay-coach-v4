import assert from 'node:assert/strict';
import {normalizeHandClass,all169} from '../src/core/hand-class.js';
import {maskDistribution} from '../src/decision/legal-mask.js';
import {chooseMixed} from '../src/strategy/mixed.js';
import {registerPack,clearPacks,registeredPackCount} from '../src/strategy/pack-registry.js';
import {decideFromRegisteredPack} from '../src/decision/decision-engine.js';

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

clearPacks();
registerPack({game:'NLHE',format:'MTT',mode:'cEV',tableSize:8,stackBucket:'17-25',node:'unopened',heroPosition:'BTN',villainPosition:'*',source:'unit-test',certification:'test-only'}, {
  AKo:{RAISE:100},
  A5s:{CALL:50,RAISE:50}
});
assert.equal(registeredPackCount(),1);

const base={tableSize:8,heroPosition:'BTN',smallBlind:500,bigBlind:1000,ante:125,playersDealt:8,heroStack:24000,villainStack:30000,pot:2500,toCall:0,entrants:1000,remaining:700,paidSpots:150,history:[],legalActions:['FOLD','CALL','RAISE']};
let r=decideFromRegisteredPack({...base,hand:'AKo'});
assert.equal(r.status,'DECISION');
assert.equal(r.decision,'RAISE');

r=decideFromRegisteredPack({...base,hand:'A5s'},{decisionKey:'mtt-mix-1'});
assert.equal(r.status,'DECISION');
assert(['CALL','RAISE'].includes(r.decision));
const r2=decideFromRegisteredPack({...base,hand:'A5s'},{decisionKey:'mtt-mix-1'});
assert.equal(r.decision,r2.decision);

r=decideFromRegisteredPack({...base,hand:'Q7o'});
assert.equal(r.status,'OUT_OF_COVERAGE');
assert.equal(r.decision,null);

r=decideFromRegisteredPack({...base,heroStack:7000,villainStack:9000,hand:'AKo'});
assert.equal(r.status,'OUT_OF_COVERAGE');

console.log('PASS — MTT strategy kernel regressions');
