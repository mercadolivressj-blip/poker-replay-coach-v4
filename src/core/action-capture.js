const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const C=(x,y,w,h)=>{const nx=clamp(x),ny=clamp(y);return{x:nx,y:ny,w:clamp(w,0.002,1-nx),h:clamp(h,0.002,1-ny)}};

// PokerStars 6-max layout calibrated from the validated replay window.
// `region` watches the player plate/avatar/action text. `cardRegion` watches only
// the two hole-card backs. Coordinates are relative to the detected felt, so the
// layout scales/moves with the table instead of being tied to the monitor.
export function seatRegionsFromFelt(f){
  if(!f) return [];
  const R=(id,label,x,y,w,h,cx,cy,cw,ch,isHero=false)=>({
    id,label,isHero,
    region:C(f.x+x*f.w,f.y+y*f.h,w*f.w,h*f.h),
    cardRegion:C(f.x+cx*f.w,f.y+cy*f.h,cw*f.w,ch*f.h),
  });
  return [
    // Hero cards sit above the bottom plate. Hero is observed for hand-transition
    // evidence but can never become a local fold candidate.
    R('hero','Hero', .34,1.04,.32,.27, .39,.92,.22,.22,true),
    R('left-low','Seat L1', -.24,.61,.36,.28, -.16,.50,.22,.20),
    R('left-high','Seat L2', -.20,-.13,.36,.28, -.12,-.18,.22,.20),
    R('top','Seat Top', .34,-.31,.32,.27, .39,-.34,.22,.20),
    R('right-high','Seat R2', .84,-.13,.36,.28, .90,-.18,.22,.20),
    R('right-low','Seat R1', .89,.61,.36,.28, .94,.50,.22,.20),
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
      const ax=Math.floor(x0+(x1-x0)*xx/gx),bx=Math.max(ax+1,Math.floor(x0+(x1-x0)*(xx+1)/gx));
      const ay=Math.floor(y0+(y1-y0)*yy/gy),by=Math.max(ay+1,Math.floor(y0+(y1-y0)*(yy+1)/gy));
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
    const cardSignature=regionSignature(data,w,h,seat.cardRegion,{gx:5,gy:3});
    return {...seat,signature,cardTexture:cardTextureScore(cardSignature)};
  });
}

const emptySeatState=()=>({
  signature:null,cardTexture:null,lastEventAt:0,stableCardTexture:null,
  cardPresent:null,presentVotes:0,absentVotes:0,
});
export function createActionCaptureState(seats=[]){
  return {version:'action-capture-v1.1',seats:Object.fromEntries(seats.map(s=>[s.id,emptySeatState()])),tableTransitionAt:0};
}

export function observeSeatSamples(stateInput,samples,now=Date.now(),opts={}){
  const motionThreshold=opts.motionThreshold??0.09;
  const foldDrop=opts.foldDrop??0.12;
  const refractoryMs=opts.refractoryMs??420;
  const presentThreshold=opts.cardPresentThreshold??0.40;
  const absentThreshold=opts.cardAbsentThreshold??0.29;
  const confirmFrames=opts.confirmFrames??2;
  const state=stateInput||createActionCaptureState(samples);
  const next={...state,seats:{...state.seats}};
  const provisional=[];
  let heroDropped=false;

  for(const s of samples){
    const prev=state.seats[s.id]||emptySeatState();
    const motion=prev.signature?signatureDistance(prev.signature,s.signature):0;
    const before=prev.cardTexture; const after=s.cardTexture;
    let presentVotes=prev.presentVotes||0,absentVotes=prev.absentVotes||0,cardPresent=prev.cardPresent;

    if(after>=presentThreshold){presentVotes++;absentVotes=0;}
    else if(after<=absentThreshold){absentVotes++;presentVotes=0;}
    else {presentVotes=Math.max(0,presentVotes-1);absentVotes=Math.max(0,absentVotes-1);}

    if(presentVotes>=confirmFrames) cardPresent=true;
    const wasPresent=prev.cardPresent===true;
    if(absentVotes>=confirmFrames) cardPresent=false;
    const becameAbsent=wasPresent&&cardPresent===false;
    if(s.isHero&&becameAbsent) heroDropped=true;

    const baseline=prev.stableCardTexture??before;
    const drop=baseline!=null&&after!=null?baseline-after:0;
    const strongDrop=becameAbsent&&drop>=foldDrop;
    const canFire=now-(prev.lastEventAt||0)>=refractoryMs;
    let type=null;

    // A confirmed present -> absent transition is semantic and occurs only once,
    // so it must outrank the visual cooldown. Otherwise the precursor animation
    // can emit CHANGE and suppress a real fast fold 80-150 ms later.
    if(!s.isHero&&strongDrop) type='fold-candidate';
    else if(!s.isHero&&canFire&&motion>=motionThreshold) type='seat-change';

    if(type){
      provisional.push({
        type,seatId:s.id,label:s.label,at:now,motion:Number(motion.toFixed(4)),
        cardTextureBefore:baseline==null?null:Number(baseline.toFixed(4)),
        cardTextureAfter:after==null?null:Number(after.toFixed(4)),
        confidence:type==='fold-candidate'?Math.min(.94,.58+Math.max(0,drop)):Math.min(.82,.4+motion),
      });
    }

    let stable=prev.stableCardTexture;
    if(cardPresent===true && motion<motionThreshold*.72){
      stable=stable==null?after:(stable*.78+after*.22);
    } else if(cardPresent!==true && presentVotes===0){
      stable=null;
    }
    next.seats[s.id]={
      signature:s.signature,cardTexture:after,lastEventAt:type?now:(prev.lastEventAt||0),
      stableCardTexture:stable,cardPresent,presentVotes,absentVotes,
    };
  }

  // When Hero cards disappear, PokerStars is usually clearing the hand. Do not
  // mislabel opponents whose cards vanish on the same animation as folds.
  const foldEvents=provisional.filter(e=>e.type==='fold-candidate');
  const massDrop=foldEvents.length>=3;
  let events=provisional;
  if(heroDropped||massDrop){
    events=provisional.filter(e=>e.type!=='fold-candidate');
    events.push({
      type:'table-transition',seatId:'table',label:'Table',at:now,motion:0,
      cardTextureBefore:null,cardTextureAfter:null,confidence:.9,
      reason:heroDropped?'hero-cards-cleared':'mass-card-clear',
    });
    next.tableTransitionAt=now;
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
  return events.map(e=>`${e.label}:${e.type}@${Math.round((e.motion||0)*1000)/1000}`);
}
