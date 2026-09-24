const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export function normalizeBlindLevel(raw={}){
 const current={
  smallBlind:Math.max(0,num(raw.smallBlind)),
  bigBlind:Math.max(0,num(raw.bigBlind)),
  ante:Math.max(0,num(raw.ante)),
  anteType:String(raw.anteType||'individual').toLowerCase()
 };
 const next={
  smallBlind:Math.max(0,num(raw.nextSmallBlind)),
  bigBlind:Math.max(0,num(raw.nextBigBlind)),
  ante:Math.max(0,num(raw.nextAnte))
 };
 return{
  current,next,
  secondsToNextLevel:Math.max(0,num(raw.secondsToNextLevel)),
  level:Number.isFinite(Number(raw.level))?Number(raw.level):null
 };
}

export function stackProjection(stackChips,level){
 const chips=Math.max(0,num(stackChips));
 const currentBB=Math.max(0,num(level?.current?.bigBlind));
 const nextBB=Math.max(0,num(level?.next?.bigBlind));
 const now=currentBB?chips/currentBB:null;
 const next=nextBB?chips/nextBB:null;
 return{
  chips,
  currentBB:now,
  nextLevelBB:next,
  bbLossAtNextLevel:now!=null&&next!=null?Math.max(0,now-next):null,
  retentionRatio:now>0&&next!=null?clamp(next/now,0,1):null
 };
}

export function blindPressure(raw={}){
 const level=raw.current?raw:normalizeBlindLevel(raw);
 const hero=stackProjection(raw.heroStack??raw.stackChips,level);
 const currentBB=Math.max(0,num(level.current?.bigBlind));
 const nextBB=Math.max(0,num(level.next?.bigBlind));
 const hasKnownNext=nextBB>0;
 const increaseRatio=currentBB&&nextBB?nextBB/currentBB:null;
 const seconds=Math.max(0,num(level.secondsToNextLevel));
 const window=seconds===0?'UNKNOWN':seconds<=60?'IMMINENT':seconds<=180?'NEAR':seconds<=600?'SOON':'LATER';
 return{
  level,
  hero,
  hasKnownNext,
  blindIncreaseRatio:increaseRatio,
  timeWindow:window,
  projectedBucketShift: hero.currentBB!=null&&hero.nextLevelBB!=null
   ? {from:bucket(hero.currentBB),to:bucket(hero.nextLevelBB),changes:bucket(hero.currentBB)!==bucket(hero.nextLevelBB)}
   : null
 };
}

function bucket(bb){
 const x=num(bb);if(x<8)return'<8';if(x<12)return'8-12';if(x<17)return'12-17';if(x<25)return'17-25';if(x<40)return'25-40';if(x<60)return'40-60';if(x<100)return'60-100';return'100+';
}
