import {all169,normalizeHandClass} from '../core/hand-class.js';
import {combosForClass} from './range-combos.js';
import {deck,parseCard} from './holdem-evaluator.js';
import {fastCompareHoldem} from './fast-holdem-evaluator.js';

function hashSeed(value){let h=2166136261>>>0;for(const ch of String(value??'mtt')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h||1}
function rng32(seed){let x=hashSeed(seed);return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296}}
const overlaps=(a,b)=>a.some(c=>b.includes(c));

export function compatibleComboCount(a,b){
 const A=combosForClass(a),B=combosForClass(b);let n=0;
 for(const x of A)for(const y of B)if(!overlaps(x,y))n++;
 return n;
}

export function compatibilityRow(heroClass,opponentClasses=all169()){
 const h=normalizeHandClass(heroClass);if(!h)throw new Error('bad_hero_class');
 return Object.fromEntries(opponentClasses.map(v=>[normalizeHandClass(v),compatibleComboCount(h,v)]));
}

export function equityClassVsClass(a,b,{iterations=4000,seed='mtt-class-equity-v1'}={}){
 const A=combosForClass(a),B=combosForClass(b),pairs=[];
 for(const x of A)for(const y of B)if(!overlaps(x,y))pairs.push([x,y]);
 if(!pairs.length)throw new Error('no_compatible_combos');
 const n=Math.max(1,Math.floor(Number(iterations)||0)),rand=rng32(`${seed}|${normalizeHandClass(a)}|${normalizeHandClass(b)}`),full=deck();
 let win=0,tie=0,lose=0;
 for(let i=0;i<n;i++){
  const [hero,villain]=pairs[Math.floor(rand()*pairs.length)];
  const dead=new Set([...hero,...villain].map(parseCard).map(c=>c.code));
  const rem=full.filter(c=>!dead.has(c));
  for(let k=0;k<5;k++){const j=k+Math.floor(rand()*(rem.length-k));[rem[k],rem[j]]=[rem[j],rem[k]]}
  const r=fastCompareHoldem(hero,villain,rem.slice(0,5)).result;
  if(r>0)win++;else if(r<0)lose++;else tie++;
 }
 const equity=(win+tie*.5)/n;
 return{a:normalizeHandClass(a),b:normalizeHandClass(b),win,tie,lose,total:n,equity,equityPct:equity*100,compatiblePairs:pairs.length,seed:String(seed)};
}

export function buildClassEquityMatrix({hands=all169(),iterationsPerPair=2000,seed='mtt-matrix-v1'}={}){
 const hs=[...new Set(hands.map(normalizeHandClass).filter(Boolean))],matrix={};
 for(const h of hs)matrix[h]={};
 for(let i=0;i<hs.length;i++)for(let j=i;j<hs.length;j++){
  const a=hs[i],b=hs[j];
  if(a===b){matrix[a][b]=0.5;continue}
  const e=equityClassVsClass(a,b,{iterations:iterationsPerPair,seed}).equity;
  matrix[a][b]=e;matrix[b][a]=1-e;
 }
 return{hands:hs,iterationsPerPair:Number(iterationsPerPair),seed:String(seed),matrix};
}
