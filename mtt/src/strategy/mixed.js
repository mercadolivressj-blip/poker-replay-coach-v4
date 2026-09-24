import {maskDistribution} from '../decision/legal-mask.js';

function hash32(text){
 let h=2166136261>>>0;for(const ch of String(text)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h>>>0;
}
export function deterministicUnit(seed){return hash32(seed)/0x100000000}
export function chooseMixed(distribution,legalActions,seed){
 const masked=maskDistribution(distribution,legalActions),entries=Object.entries(masked).filter(([,w])=>Number(w)>0),total=entries.reduce((a,[,w])=>a+Number(w),0);
 if(!entries.length||total<=0)return null;
 let x=deterministicUnit(seed)*total;
 for(const [a,w] of entries){x-=Number(w);if(x<=0)return{action:a,masked,total}}
 return{action:entries.at(-1)[0],masked,total};
}
