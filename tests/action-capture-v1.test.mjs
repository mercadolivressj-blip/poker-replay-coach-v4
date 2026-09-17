import assert from 'node:assert/strict';
import { seatRegionsFromFelt, createActionCaptureState, observeSeatSamples, signatureDistance, cardTextureScore, createFrameRing, pushFrameRing, framesAround } from '../src/core/action-capture.js';

const sig=(v,{edge=.04,col=.2,bright=.1}={})=>({vector:Array(48).fill(v),edgeMean:edge,coloredFrac:col,brightFrac:bright});
assert.equal(signatureDistance(sig(.2),sig(.2)),0);
assert(signatureDistance(sig(.2),sig(.5))>.25);
assert(cardTextureScore(sig(.2,{edge:.12,col:.35,bright:.08}))>.3);

// Calibrated geometry must keep six PokerStars seats and distinguish Hero.
const felt={x:.235,y:.216,w:.525,h:.423};
const regions=seatRegionsFromFelt(felt);
assert.equal(regions.length,6);
assert.equal(regions.filter(s=>s.isHero).length,1);
assert(regions.every(s=>s.region.w>0&&s.cardRegion.w>0));
const hero=regions.find(s=>s.id==='hero');
const lh=regions.find(s=>s.id==='left-high');
assert(hero.cardRegion.y>felt.y+felt.h*.85);
assert(lh.cardRegion.y<felt.y);

const seats=[{id:'left-high',label:'Seat L2',isHero:false}];
let state=createActionCaptureState(seats);
// Two stable high-texture samples establish cards as present.
let o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.2),cardTexture:.52}],1000,{confirmFrames:2});
assert.equal(o.events.length,0);state=o.state;
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.2),cardTexture:.53}],1100,{confirmFrames:2});
assert.equal(o.events.length,0);assert.equal(o.state.seats['left-high'].cardPresent,true);state=o.state;
// Motion event is emitted immediately for an opponent.
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.36),cardTexture:.52}],1700,{confirmFrames:2});
assert.equal(o.events.length,1);assert.equal(o.events[0].type,'seat-change');state=o.state;
// Refractory prevents spam from animation frames.
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.48),cardTexture:.50}],1800,{confirmFrames:2});
assert.equal(o.events.length,0);state=o.state;
// One low frame is not enough to call a fold.
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.20),cardTexture:.20}],2400,{confirmFrames:2});
assert.equal(o.events.filter(e=>e.type==='fold-candidate').length,0);state=o.state;
// Second confirmed low frame becomes a fold candidate.
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.19),cardTexture:.18}],2500,{confirmFrames:2});
assert.equal(o.events.length,1);assert.equal(o.events[0].type,'fold-candidate');
assert(o.events[0].confidence>.5);

// Hero can never be emitted as a local fold candidate. Its card clear becomes
// table-transition evidence so simultaneous opponent clears are suppressed.
let hs=createActionCaptureState([{id:'hero',label:'Hero',isHero:true},{id:'right-high',label:'Seat R2',isHero:false}]);
for(const t of [3000,3100]){
  const r=observeSeatSamples(hs,[
    {id:'hero',label:'Hero',isHero:true,signature:sig(.2),cardTexture:.55},
    {id:'right-high',label:'Seat R2',isHero:false,signature:sig(.2),cardTexture:.54},
  ],t,{confirmFrames:2});hs=r.state;
}
let r=observeSeatSamples(hs,[
  {id:'hero',label:'Hero',isHero:true,signature:sig(.2),cardTexture:.18},
  {id:'right-high',label:'Seat R2',isHero:false,signature:sig(.2),cardTexture:.19},
],3800,{confirmFrames:2});hs=r.state;
r=observeSeatSamples(hs,[
  {id:'hero',label:'Hero',isHero:true,signature:sig(.2),cardTexture:.17},
  {id:'right-high',label:'Seat R2',isHero:false,signature:sig(.2),cardTexture:.18},
],3900,{confirmFrames:2});
assert.equal(r.events.some(e=>e.seatId==='hero'&&e.type==='fold-candidate'),false);
assert.equal(r.events.some(e=>e.type==='table-transition'),true);
assert.equal(r.events.some(e=>e.type==='fold-candidate'),false);

let ring=createFrameRing({windowMs:3000,maxFrames:10});
for(let i=0;i<8;i++) ring=pushFrameRing(ring,{at:1000+i*500,id:i});
assert(ring.frames.every(f=>4500-f.at<=3000));
const around=framesAround(ring,3000,{beforeMs:600,afterMs:600});
assert.deepEqual(around.map(f=>f.id),[3,4,5]);
console.log('action-capture-v1.1 regressions: OK');
