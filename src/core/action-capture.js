const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const C=(x,y,w,h)=>({x:clamp(x),y:clamp(y),w:clamp(w,0.002,1-clamp(x)),h:clamp(h,0.002,1-clamp(y))});

// PokerStars 6-max visual slots relative to the detected felt. Hero is fixed at the bottom.
// Regions are intentionally generous: they are event sensors, not OCR boxes.
export function seatRegionsFromFelt(f){
  if(!f) return [];
  const R=(id,label,x,y,w,h,cx,cy,cw,ch)=>({
    id,label,
    region:C(f.x+x*f.w,f.y+y*f.h,w*f.w,h*f.h),
    cardRegion:C(f.x+cx*f.w,f.y+cy*f.h,cw*f.w,ch*f.h),
  });
  return [
    R('hero','Hero', .34,.77,.32,.33, .405,.88,.19,.20),
    R('left-low','Seat L1', -.03,.58,.31,.29, .14,.54,.12,.16),
    R('left-high','Seat L2', -.04,.10,.31,.29, .12,.18,.12,.16),
    R('top','Seat Top', .34,-.15,.32,.30, .44,.04,.12,.16),
    R('right-high','Seat R2', .73,.10,.31,.29, .76,.18,.12,.16),
    R('right-low','Seat R1', .72,.58,.31,.29, .74,.54,.12,.16),
  ];
}

function rectPx(rect,w,h){
  const x0=Math.max(0,Math.min(w-1,Math.floor(rect.x*w)));
  const y0=Math.max(0,Math.min(h-1,Math.floor(rect.y*h)));
  const x1=Math.max(x0+1,Math.min(w,Math.ceil((rect.x+rect.w)*w)));
  const y1=Math.max(y0+1,Math.min(h,Math.ceil((rect.y+rect.h)*h)));
  return {x0,y0,x1,y1};
}
const lum=(r,g,b)=>(0.2126*r+0.7152*g+0.0722*b)/255;
const saturation=(r,g,b)=>{const hi=Math.max(r,g,b),lo=Math.min(r,g,b);return hi===0?0:(hi-lo)/hi;};

export function regionSignature(data,w,h,rect,{gx=6,gy=4}={}){
  if(!data||!w||!h||!rect) return null;
  const {x0,y0,x1,y1}=rectPx(rect,w,h);
  const out=[]; let edge=0,edgeN=0,colored=0,bright=0,n=0;
  for(let yy=0;yy<gy;yy++){
    for(let xx=0;xx<gx;xx++){
      const ax=Math.floor(x0+(x1-x0)*xx/gx), bx=Math.max(ax+1,Math.floor(x0+(x1-x0)*(xx+1)/gx));
      const ay=Math.floor(y0+(y1-y0)*yy/gy), by=Math.max(ay+1,Math.floor(y0+(y1-y0)*(yy+1)/gy));
      let L=0,S=0,m=0;
      for(let y=ay;y<by;y+=2){let prev=null;for(let x=ax;x<bx;x+=2){
        const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2],l=lum(r,g,b),s=saturation(r,g,b);
        L+=l;S+=s;m++;n++;if(s>.24)colored++;if(l>.68)bright++;if(prev!=null){edge+=Math.abs(l-prev);edgeN++;}prev=l;
      }}
      out.push(m?L/m:0,m?S/m:0);
    }
  }
  return {vector:out,edgeMean:edge/Math.max(1,edgeN),coloredFrac:colored/Math.max(1,n),brightFrac:bright/Math.max(1,n)};
}

export function signatureDistance(a,b){
  if(!a?.vector||!b?.vector||a.vector.length!==b.vector.length) return 1;
  let sum=0;for(let i=0;i<a.vector.length;i++)sum+=Math.abs(a.vector[i]-b.vector[i]);
  const base=sum/a.vector.length;
  return clamp(base+Math.abs((a.edgeMean||0)-(b.edgeMean||0))*.45+Math.abs((a.coloredFrac||0)-(b.coloredFrac||0))*.18);
}

export function cardTextureScore(sig){
  if(!sig) return 0;
  return clamp((sig.edgeMean||0)*1.9+(sig.coloredFrac||0)*.55+(sig.brightFrac||0)*.35);
}

export function sampleSeats(data,w,h,felt){
  return seatRegionsFromFelt(felt).map((seat)=>{
    const signature=regionSignature(data,w,h,seat.region);
    const cardSignature=regionSignature(data,w,h,seat.cardRegion,{gx:4,gy:3});
    return {...seat,signature,cardTexture:cardTextureScore(cardSignature)};
  });
}

export function createActionCaptureState(seats=[]){
  return {version:'action-capture-v1',seats:Object.fromEntries(seats.map(s=>[s.id,{signature:null,cardTexture:null,lastEventAt:0,stableCardTexture:null}]))};
}

export function observeSeatSamples(stateInput,samples,now=Date.now(),opts={}){
  const motionThreshold=opts.motionThreshold??0.075;
  const foldDrop=opts.foldDrop??0.12;
  const refractoryMs=opts.refractoryMs??420;
  const state=stateInput||createActionCaptureState(samples);
  const next={...state,seats:{...state.seats}};const events=[];
  for(const s of samples){
    const prev=state.seats[s.id]||{signature:null,cardTexture:null,lastEventAt:0,stableCardTexture:null};
    const motion=prev.signature?signatureDistance(prev.signature,s.signature):0;
    const before=prev.cardTexture;const after=s.cardTexture;
    const cardDrop=before!=null&&after!=null&&(before-after)>=foldDrop;
    const canFire=now-(prev.lastEventAt||0)>=refractoryMs;
    let type=null;
    if(canFire&&cardDrop) type='fold-candidate';
    else if(canFire&&motion>=motionThreshold) type='seat-change';
    if(type){events.push({type,seatId:s.id,label:s.label,at:now,motion:Number(motion.toFixed(4)),cardTextureBefore:before==null?null:Number(before.toFixed(4)),cardTextureAfter:after==null?null:Number(after.toFixed(4)),confidence:type==='fold-candidate'?Math.min(.92,.55+(before-after)):Math.min(.82,.4+motion)});}
    next.seats[s.id]={signature:s.signature,cardTexture:after,lastEventAt:type?now:(prev.lastEventAt||0),stableCardTexture:motion<motionThreshold*.65?after:prev.stableCardTexture};
  }
  return {state:next,events};
}

export function createFrameRing({windowMs=3000,maxFrames=48}={}){
  return {version:'frame-ring-v1',windowMs,maxFrames,frames:[]};
}
export function pushFrameRing(ringInput,frame){
  const ring=ringInput||createFrameRing();const at=Number(frame?.at)||Date.now();
  const frames=[...(ring.frames||[]),{...frame,at}].filter(f=>at-f.at<=ring.windowMs).slice(-ring.maxFrames);
  return {...ring,frames};
}
export function framesAround(ring,at,{beforeMs=1000,afterMs=1000}={}){
  return (ring?.frames||[]).filter(f=>f.at>=at-beforeMs&&f.at<=at+afterMs);
}

export function actionCaptureSummary(events=[]){
  return events.map(e=>`${e.label}:${e.type}@${Math.round(e.motion*1000)/1000}`);
}
