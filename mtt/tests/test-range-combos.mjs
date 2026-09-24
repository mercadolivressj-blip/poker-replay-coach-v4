import assert from 'node:assert/strict';
import {combosForClass,comboCountForClass,expandWeightedRange,normalizeWeightedRange} from '../src/math/range-combos.js';

assert.equal(comboCountForClass('AA'),6);
assert.equal(comboCountForClass('AKs'),4);
assert.equal(comboCountForClass('AKo'),12);
assert.equal(new Set(combosForClass('AA').map(x=>x.slice().sort().join(''))).size,6);
assert.equal(new Set(combosForClass('AKs').map(x=>x.slice().sort().join(''))).size,4);
assert.equal(new Set(combosForClass('AKo').map(x=>x.slice().sort().join(''))).size,12);

const r=normalizeWeightedRange({AA:1,AKs:.5,trash:0});
assert.deepEqual(r,[{hand:'AA',weight:1},{hand:'AKs',weight:.5}]);

const e=expandWeightedRange({AA:1,AKs:.5},{deadCards:['Ac']});
assert.equal(e.filter(x=>x.hand==='AA').length,3);
assert.equal(e.filter(x=>x.hand==='AKs').length,3);
assert(e.every(x=>!x.cards.includes('Ac')));

console.log('PASS — range combo regressions');
