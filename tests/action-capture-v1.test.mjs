import assert from 'node:assert/strict';
import { createActionCaptureState, observeSeatSamples, signatureDistance, cardTextureScore, createFrameRing, pushFrameRing, framesAround } from '../src/core/action-capture.js';

const sig=(v,{edge=.04,col=.2,bright=.1}={})=>({vector:Array(48).fill(v),edgeMean:edge,coloredFrac:col,brightFrac:bright});
assert.equal(signatureDistance(sig(.2),sig(.2)),0);
assert(signatureDistance(sig(.2),sig(.5))>.25);
assert(cardTextureScore(sig(.2,{edge:.12,col:.35,bright:.08}))>.3);

const seats=[{id:'left-high',label:'Seat L2'}];
let state=createActionCaptureState(seats);
let o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',signature:sig(.2),cardTexture:.48}],1000);
assert.equal(o.events.length,0);state=o.state;
// Motion event is emitted immediately.
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',signature:sig(.36),cardTexture:.47}],1600);
assert.equal(o.events.length,1);assert.equal(o.events[0].type,'seat-change');state=o.state;
// Refractory prevents spam from animation frames.
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',signature:sig(.48),cardTexture:.46}],1750);
assert.equal(o.events.length,0);state=o.state;
// Strong card-region texture disappearance becomes a fold candidate.
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',signature:sig(.18),cardTexture:.20}],2300);
assert.equal(o.events.length,1);assert.equal(o.events[0].type,'fold-candidate');
assert(o.events[0].confidence>.5);

let ring=createFrameRing({windowMs:3000,maxFrames:10});
for(let i=0;i<8;i++) ring=pushFrameRing(ring,{at:1000+i*500,id:i});
assert(ring.frames.every(f=>4500-f.at<=3000));
const around=framesAround(ring,3000,{beforeMs:600,afterMs:600});
assert.deepEqual(around.map(f=>f.id),[3,4,5]);
console.log('action-capture-v1 regressions: OK');
