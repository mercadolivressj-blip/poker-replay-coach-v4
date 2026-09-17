import assert from 'node:assert/strict';
import { createActionBandState, observeActionBands } from '../src/core/action-band.js';

const sig=(v)=>({vector:Array(50).fill(v),edgeMean:v,coloredFrac:v,brightFrac:v});
const samples=(v)=>[
  {id:'left-high',label:'Seat L2',signature:sig(v)},
  {id:'right-high',label:'Seat R2',signature:sig(v)},
];

let s=createActionBandState(samples(0.1));
let out=observeActionBands(s,samples(0.1),1000,{threshold:.026,refractoryMs:180});
s=out.state;
assert.equal(out.events.length,0,'first/baseline frame must not fire');

out=observeActionBands(s,samples(0.11),1100,{threshold:.026,refractoryMs:180});
s=out.state;
assert.equal(out.events.length,0,'small action-band noise must not fire');

out=observeActionBands(s,samples(0.30),1200,{threshold:.026,refractoryMs:180});
s=out.state;
assert.equal(out.events.length,2,'large transient action-band change must fire per opponent seat');
assert.equal(out.events[0].type,'action-band-change');

out=observeActionBands(s,samples(0.31),1250,{threshold:.026,refractoryMs:180});
assert.equal(out.events.length,0,'refractory suppresses immediate duplicate');

console.log('action-band-v1 regressions: OK');
