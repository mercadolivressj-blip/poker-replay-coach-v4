import { regionSignature, signatureDistance, seatRegionsFromFelt } from './action-capture.js';

const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const sub=(r,x,y,w,h)=>({
  x:clamp(r.x+x*r.w),
  y:clamp(r.y+y*r.h),
  w:clamp(w*r.w,0.002,1-clamp(r.x+x*r.w)),
  h:clamp(h*r.h,0.002,1-clamp(r.y+y*r.h)),
});

// Focused band for PokerStars' transient action label. This is intentionally
// separate from Action Capture V1.2 so the approved fold detector stays frozen.
export function actionBandRegionsFromFelt(felt){
  return seatRegionsFromFelt(felt)
    .filter(s=>!s.isHero)
    .map(s=>({
      id:s.id,label:s.label,isHero:false,
      // Broad enough to cover name/action/stack label, but excludes most hole cards.
      region:sub(s.region,.02,.06,.96,.72),
      seatRegion:s.region,
    }));
}

export function sampleActionBands(data,w,h,felt){
  return actionBandRegionsFromFelt(felt).map(b=>({
    ...b,
    signature:regionSignature(data,w,h,b.region,{gx:10,gy:5}),
  }));
}

export function createActionBandState(bands=[]){
  return {
    version:'action-band-v1',
    bands:Object.fromEntries(bands.map(b=>[b.id,{signature:null,lastFireAt:0,pendingVotes:0}])),
  };
}

export function observeActionBands(stateInput,samples,now=Date.now(),opts={}){
  const threshold=opts.threshold??0.026;
  const refractoryMs=opts.refractoryMs??180;
  const confirmFrames=opts.confirmFrames??1;
  const state=stateInput||createActionBandState(samples);
  const next={...state,bands:{...state.bands}};
  const events=[];
  for(const s of samples){
    const prev=state.bands?.[s.id]||{signature:null,lastFireAt:0,pendingVotes:0};
    const motion=prev.signature?signatureDistance(prev.signature,s.signature):0;
    const hit=motion>=threshold;
    const votes=hit?(prev.pendingVotes||0)+1:0;
    const canFire=now-(prev.lastFireAt||0)>=refractoryMs;
    let lastFireAt=prev.lastFireAt||0;
    if(hit&&votes>=confirmFrames&&canFire){
      events.push({
        type:'action-band-change',seatId:s.id,label:s.label,at:now,
        motion:Number(motion.toFixed(4)),confidence:Math.min(.90,.45+motion*3),
      });
      lastFireAt=now;
    }
    next.bands[s.id]={signature:s.signature,lastFireAt,pendingVotes:hit?votes:0};
  }
  return {state:next,events};
}
