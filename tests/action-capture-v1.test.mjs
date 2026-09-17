import assert from 'node:assert/strict';
import { seatRegionsFromFelt, createActionCaptureState, observeSeatSamples, signatureDistance, cardTextureScore, cardBackPresenceScore, createFrameRing, pushFrameRing, framesAround } from '../src/core/action-capture.js';

const sig=(v,{edge=.04,col=.2,bright=.1}={})=>({vector:Array(48).fill(v),edgeMean:edge,coloredFrac:col,brightFrac:bright});
assert.equal(signatureDistance(sig(.2),sig(.2)),0);
assert(signatureDistance(sig(.2),sig(.5))>.25);
assert(cardTextureScore(sig(.2,{edge:.12,col:.35,bright:.08}))>.3);

// Red PokerStars card backs must separate strongly from green felt.
const rgba=(w,h,paint)=>{const d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const [r,g,b]=paint(x,y);const i=(y*w+x)*4;d[i]=r;d[i+1]=g;d[i+2]=b;d[i+3]=255;}return d;};
const full={x:0,y:0,w:1,h:1};
const green=rgba(30,20,()=>[26,120,58]);
const backs=rgba(30,20,(x,y)=>{
  const card=(x>=3&&x<=13)||(x>=16&&x<=27); const border=card&&(y<2||y>17||x%13<2);
  if(border)return[225,220,214];
  if(card)return[154,62,61];
  return[26,120,58];
});
assert(cardBackPresenceScore(backs,30,20,full)>.28);
assert(cardBackPresenceScore(green,30,20,full)<.16);

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
let o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.2),cardTexture:.52}],1000,{confirmFrames:2});
assert.equal(o.events.length,0);state=o.state;
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.2),cardTexture:.53}],1100,{confirmFrames:2});
assert.equal(o.events.length,0);assert.equal(o.state.seats['left-high'].cardPresent,true);state=o.state;
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.36),cardTexture:.52}],1700,{confirmFrames:2});
assert.equal(o.events.length,1);assert.equal(o.events[0].type,'seat-change');state=o.state;
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.48),cardTexture:.50}],1800,{confirmFrames:2});
assert.equal(o.events.length,0);state=o.state;
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.20),cardTexture:.20}],2400,{confirmFrames:2});
assert.equal(o.events.filter(e=>e.type==='fold-candidate').length,0);state=o.state;
o=observeSeatSamples(state,[{id:'left-high',label:'Seat L2',isHero:false,signature:sig(.19),cardTexture:.18}],2500,{confirmFrames:2});
assert.equal(o.events.length,1);assert.equal(o.events[0].type,'fold-candidate');
assert(o.events[0].confidence>.5);

// Explicit red-back mode: two back-present frames, then two absent frames => fold.
let bs=createActionCaptureState([{id:'right-low',label:'Seat R1',isHero:false}]);
for(const t of [5000,5100]){const q=observeSeatSamples(bs,[{id:'right-low',label:'Seat R1',isHero:false,cardMode:'back',signature:sig(.2),cardTexture:.62}],t,{confirmFrames:2});bs=q.state;}
let q=observeSeatSamples(bs,[{id:'right-low',label:'Seat R1',isHero:false,cardMode:'back',signature:sig(.2),cardTexture:.08}],5200,{confirmFrames:2});bs=q.state;assert.equal(q.events.length,0);
q=observeSeatSamples(bs,[{id:'right-low',label:'Seat R1',isHero:false,cardMode:'back',signature:sig(.2),cardTexture:.07}],5300,{confirmFrames:2});assert.equal(q.events[0].type,'fold-candidate');

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
console.log('action-capture-v1.2 regressions: OK');
