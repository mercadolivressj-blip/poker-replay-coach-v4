import assert from 'node:assert/strict';
import {deck52,allTwoCardCombos,canonicalCombo} from '../src/cards.mjs';
import {all169HandClasses,expandHandClass,handClassFromCards} from '../src/hand-classes.mjs';
import {createComboRange,fullDeckRange,removeDeadCards,effectiveComboCount,physicalComboCount,normalizedComboProbabilities,rangeAudit} from '../src/combo-range.mjs';

assert.equal(deck52().length,52);
assert.equal(new Set(deck52()).size,52);
assert.equal(allTwoCardCombos().length,1326);
assert.equal(new Set(allTwoCardCombos()).size,1326);
assert.equal(all169HandClasses().length,169);

assert.equal(expandHandClass('AA').length,6);
assert.equal(expandHandClass('AKs').length,4);
assert.equal(expandHandClass('AKo').length,12);
assert.equal(handClassFromCards('Ks','3s'),'K3s');
assert.equal(handClassFromCards('3d','Kh'),'K3o');
assert.equal(handClassFromCards('7h','7c'),'77');

const dead=['Ks','3s','4s','2h','Kh','7d','3h'];
const universe=removeDeadCards(fullDeckRange(),dead);
assert.equal(physicalComboCount(universe),990); // C(45,2)
assert.equal(effectiveComboCount(universe),990);

const k3s=createComboRange({entries:[{handClass:'K3s',weight:1}],source:'unit-test',status:'reference-only'});
assert.equal(physicalComboCount(k3s),4);
const k3sLive=removeDeadCards(k3s,dead);
assert.equal(physicalComboCount(k3sLive),2);
assert(k3sLive.weights.has(canonicalCombo('Kc','3c')));
assert(k3sLive.weights.has(canonicalCombo('Kd','3d')));

const mixed=createComboRange({
  entries:[{handClass:'AA',weight:1},{handClass:'AKs',weight:.5},{handClass:'AKo',weight:.25}],
  source:'synthetic-test',status:'reference-only',depthBb:100,position:'BTN',node:'RFI'
});
assert.equal(physicalComboCount(mixed),22);
assert.equal(effectiveComboCount(mixed),6 + 4*.5 + 12*.25);
assert.equal(mixed.decisionCertified,false);
const probs=normalizedComboProbabilities(mixed);
const ps=[...probs.values()].reduce((a,b)=>a+b,0);
assert(Math.abs(ps-1)<1e-12);

const certified=createComboRange({
  entries:[{handClass:'AA',weight:1}],source:'verified-fixture',status:'certified',depthBb:100,position:'BTN',node:'RFI'
});
assert.equal(certified.decisionCertified,true);

assert.throws(()=>createComboRange({entries:[{handClass:'AKs'},{handClass:'AKs',weight:.5}]}),/overlapping_range_entries/);
assert.throws(()=>removeDeadCards(fullDeckRange(),['Ks','Ks']),/duplicate_dead_card/);
assert.throws(()=>expandHandClass('AK'),/requires_s_or_o/);

const audit=rangeAudit(k3sLive);
assert.equal(audit.physicalCombos,2);
assert.equal(audit.deadCards.length,7);
assert(Math.abs(audit.probabilitySum-1)<1e-12);

console.log('PASS — Cash Pro Lab V0.2 canonical 1326-combo range regressions');
