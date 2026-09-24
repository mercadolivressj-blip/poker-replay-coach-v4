import {normalizePosition} from './positions.js';
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2};

export function normalizeTableState(raw={}){
 const bb=Math.max(0,num(raw.bigBlind));
 if(bb<=0)throw new Error('table_state_big_blind_required');
 const nextBB=Math.max(0,num(raw.nextBigBlind));
 const seats=(Array.isArray(raw.seats)?raw.seats:[]).map((s,i)=>({
  seat:s.seat??i+1,
  position:normalizePosition(s.position||''),
  stack:Math.max(0,num(s.stack)),
  inHand:s.inHand!==false,
  occupied:s.occupied!==false,
  hero:Boolean(s.hero)
 })).filter(s=>s.occupied);
 const active=seats.filter(s=>s.stack>0);
 const stacks=active.map(s=>s.stack);
 const total=stacks.reduce((a,b)=>a+b,0),avg=stacks.length?total/stacks.length:0,med=median(stacks);
 const ranked=[...active].sort((a,b)=>b.stack-a.stack);
 const enriched=seats.map(s=>({
  ...s,
  stackBB:s.stack/bb,
  nextLevelBB:nextBB?s.stack/nextBB:null,
  rankAtTable:s.stack>0?ranked.findIndex(x=>x.seat===s.seat)+1:null,
  vsTableAverage:avg?s.stack/avg:null
 }));
 const hero=enriched.find(s=>s.hero)||null;
 return{
  bigBlind:bb,nextBigBlind:nextBB||null,
  occupiedCount:seats.length,
  activeCount:active.length,
  stacks:{total,average:avg,median:med,max:stacks.length?Math.max(...stacks):0,min:stacks.length?Math.min(...stacks):0},
  seats:enriched,
  hero,
  heroTableRank:hero?.rankAtTable??null,
  heroVsAverage:hero?.vsTableAverage??null
 };
}

export function effectiveStacksByOpponent(table){
 if(!table?.hero)return[];
 return table.seats.filter(s=>s.stack>0&&!s.hero).map(v=>({
  seat:v.seat,position:v.position,
  effectiveChips:Math.min(table.hero.stack,v.stack),
  effectiveBB:Math.min(table.hero.stack,v.stack)/table.bigBlind
 }));
}
