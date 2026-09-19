import assert from 'node:assert/strict';
import {parseMoneyLike,resolveSeatIdentity} from '../src/brain/seat-identity.js';

assert.equal(parseMoneyLike('US$ 1,70'),1.70);
assert.equal(parseMoneyLike('3.24'),3.24);

const explicit=resolveSeatIdentity([
  {name:'HeroName',isHero:true,visualSlot:'hero',stack:'0,74'},
  {name:'Alice',visualSlot:'left-high',stack:'1,64'},
]);
assert.equal(explicit.map.hero,'HeroName');
assert.equal(explicit.map['left-high'],'Alice');
assert.equal(explicit.evidence.find(e=>e.slot==='left-high').confidence,1);

const stack=resolveSeatIdentity([
  {name:'HeroName',isHero:true,stack:'0,74'},
  {name:'Alice',stack:'1,64'},
  {name:'Bob',stack:'2,21'},
],{
  localStacks:{hero:.74,'left-high':1.64,'right-high':2.21},
});
assert.equal(stack.map.hero,'HeroName');
assert.equal(stack.map['left-high'],'Alice');
assert.equal(stack.map['right-high'],'Bob');

// Ambiguous identical stacks must not be force-matched.
const ambiguous=resolveSeatIdentity([
  {name:'A',stack:'1,00'},{name:'B',stack:'1,00'}
],{localStacks:{'left-high':1.00}});
assert.equal(ambiguous.map['left-high'],undefined);

// Ordered mapping is opt-in only.
const rows=[
  {name:'Hero',isHero:true},{name:'L1'},{name:'L2'},{name:'Top'},{name:'R2'},{name:'R1'}
];
const noOrder=resolveSeatIdentity(rows);
assert.equal(noOrder.map['left-low'],undefined);
const ordered=resolveSeatIdentity(rows,{orderedFromHero:true,orientation:'left'});
assert.equal(ordered.map.hero,'Hero');
assert.equal(ordered.map['left-low'],'L1');
assert.equal(ordered.map.top,'Top');

console.log('seat-identity-v1 regressions: OK');
