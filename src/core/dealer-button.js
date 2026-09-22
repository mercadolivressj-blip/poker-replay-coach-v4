const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));

export const VISUAL_ORDER=['hero','left-low','left-high','top','right-high','right-low'];
export const POSITIONS_BY_N={
  6:['BTN','SB','BB','UTG','HJ','CO'],
  5:['BTN','SB','BB','UTG','CO'],
  4:['BTN','SB','BB','CO'],
  3:['BTN','SB','BB'],
  2:['SB','BB'],
};

// Visual order follows the physical PokerStars table clockwise from Hero:
// Hero -> left-low -> left-high -> top -> right-high -> right-low -> Hero.
// Therefore the next occupied seat after the dealer is SB, then BB, etc.
export function positionsFromDealer(activeSlots,dealerSeat){
  const slots=VISUAL_ORDER.filter(id=>(activeSlots||[]).includes(id));
  const positions=POSITIONS_BY_N[slots.length];
  if(!positions||!dealerSeat)return{};
  const d=slots.indexOf(dealerSeat);if(d<0)return{};
  const map={};
  for(let j=0;j<slots.length;j++)map[slots[(d+j)%slots.length]]=positions[j];
  return map;
}

export function heroPositionFromDealer(activeSlots,dealerSeat){
  return positionsFromDealer(activeSlots,dealerSeat).hero||null;
}

const SLOT_ANCHORS={
  hero:[.50,1.13],
  'left-low':[-.02,.72],
  'left-high':[-.01,.02],
  top:[.50,-.17],
  'right-high':[1.01,.03],
  'right-low':[1.03,.72],
};

const redPixel=(r,g,b)=>r>135&&r>g*1.28&&r>b*1.18&&(r-Math.min(g,b))>45;
const whitePixel=(r,g,b)=>r>180&&g>180&&b>180&&(Math.max(r,g,b)-Math.min(r,g,b))<58;

function expandedMask(data,w,h,x0,y0,x1,y1){
  const rw=x1-x0,rh=y1-y0,base=new Uint8Array(rw*rh),red=new Uint8Array(rw*rh),white=new Uint8Array(rw*rh);
  for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){
    const si=((y+y0)*w+(x+x0))*4,r=data[si],g=data[si+1],b=data[si+2],i=y*rw+x;
    if(redPixel(r,g,b)){base[i]=1;red[i]=1;} else if(whitePixel(r,g,b)){base[i]=1;white[i]=1;}
  }
  // One-pixel dilation joins the red center to the pale rim of the small dealer disc.
  const mask=new Uint8Array(rw*rh);
  for(let y=0;y<rh;y++)for(let x=0;x<rw;x++){
    let hit=0;for(let dy=-1;dy<=1&&!hit;dy++)for(let dx=-1;dx<=1;dx++){
      const xx=x+dx,yy=y+dy;if(xx>=0&&xx<rw&&yy>=0&&yy<rh&&base[yy*rw+xx]){hit=1;break;}
    }mask[y*rw+x]=hit;
  }
  return{mask,red,white,rw,rh};
}

export function detectDealerButtonSeat(data,w,h,felt){
  if(!data||!w||!h||!felt)return null;
  const fx=felt.x*w,fy=felt.y*h,fw=felt.w*w,fh=felt.h*h;
  const x0=Math.max(0,Math.floor(fx-fw*.30)),x1=Math.min(w,Math.ceil(fx+fw*1.30));
  const y0=Math.max(0,Math.floor(fy-fh*.48)),y1=Math.min(h,Math.ceil(fy+fh*1.46));
  const {mask,red,white,rw,rh}=expandedMask(data,w,h,x0,y0,x1,y1);
  const seen=new Uint8Array(mask.length),qx=new Int32Array(mask.length),qy=new Int32Array(mask.length);
  const minW=Math.max(4,fw*.020),maxW=Math.max(10,fw*.095),minH=Math.max(4,fh*.035),maxH=Math.max(10,fh*.18);
  let best=null,second=null;
  for(let sy=0;sy<rh;sy++)for(let sx=0;sx<rw;sx++){
    const start=sy*rw+sx;if(!mask[start]||seen[start])continue;
    let head=0,tail=0,minX=sx,maxX=sx,minY=sy,maxY=sy,area=0,redN=0,whiteN=0;
    qx[tail]=sx;qy[tail]=sy;tail++;seen[start]=1;
    while(head<tail){
      const x=qx[head],y=qy[head];head++;area++;
      const idx=y*rw+x;if(red[idx])redN++;if(white[idx])whiteN++;
      if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||xx>=rw||yy<0||yy>=rh)continue;
        const ni=yy*rw+xx;if(mask[ni]&&!seen[ni]){seen[ni]=1;qx[tail]=xx;qy[tail]=yy;tail++;}
      }
    }
    const bw=maxX-minX+1,bh=maxY-minY+1;if(bw<minW||bw>maxW||bh<minH||bh>maxH)continue;
    if(redN<2||whiteN<2)continue;
    const box=Math.max(1,bw*bh),redFrac=redN/box,whiteFrac=whiteN/box;
    const aspect=Math.min(bw,bh)/Math.max(bw,bh);if(aspect<.48)continue;
    const cx=x0+(minX+maxX+1)/2,cy=y0+(minY+maxY+1)/2;
    // Board/hero cards are red+white too, but sit well inside the felt. Dealer disc lives near its perimeter.
    const nx=(cx-fx)/fw,ny=(cy-fy)/fh;
    const insideCore=nx>.13&&nx<.87&&ny>.14&&ny<.88;if(insideCore)continue;
    let nearest=null;
    for(const [seatId,[ax,ay]] of Object.entries(SLOT_ANCHORS)){
      const dist=Math.hypot(nx-ax,(ny-ay)*.72);
      if(!nearest||dist<nearest.dist)nearest={seatId,dist};
    }
    if(!nearest||nearest.dist>.46)continue;
    const color=Math.min(1,redFrac*7)+Math.min(1,whiteFrac*5);
    const sizeTarget=Math.max(6,fw*.045),size=Math.sqrt(bw*bh),sizeScore=clamp(1-Math.abs(size-sizeTarget)/(sizeTarget*1.5));
    const score=color*.42+aspect*.18+sizeScore*.16+clamp(1-nearest.dist/.46)*.34;
    const row={seatId:nearest.seatId,score:Number(score.toFixed(4)),cx,cy,bw,bh,redFrac,whiteFrac};
    if(!best||row.score>best.score){second=best;best=row;}else if(!second||row.score>second.score)second=row;
  }
  if(!best||best.score<.72)return null;
  if(second&&second.seatId!==best.seatId&&best.score-second.score<.08)return null;
  return best;
}
