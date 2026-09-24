import {all169,normalizeHandClass} from '../core/hand-class.js';
import {comboCountForClass} from '../math/range-combos.js';
import {compatibleComboCount} from '../math/class-equity.js';

const EPS=1e-12;
function regretStrategy(rFold,rAgg){const a=Math.max(0,rFold),b=Math.max(0,rAgg),s=a+b;return s>EPS?b/s:0.5}
function clamp01(x){return Math.max(0,Math.min(1,Number(x)||0))}
function matrixEq(matrix,a,b){const e=matrix?.[a]?.[b];if(!Number.isFinite(e))throw new Error(`equity_missing:${a}:${b}`);return e}
function compatibleUniverse(hero,hands){return hands.reduce((s,v)=>s+compatibleComboCount(hero,v),0)}

export function shoveActionEV(hand,{stackBB,callStrategy,equityMatrix,hands=all169()}){
 const h=normalizeHandClass(hand),S=Number(stackBB);if(!(S>1))throw new Error('stack_must_exceed_1bb');
 let total=0,ev=0;
 for(const v of hands){const w=compatibleComboCount(h,v);if(!w)continue;total+=w;const c=clamp01(callStrategy[v]);if(c<=0){ev+=w*1;continue}const showdown=S*(2*matrixEq(equityMatrix,h,v)-1);ev+=w*((1-c)*1+c*showdown)}
 return total?ev/total:-0.5;
}

export function bbCallActionEV(hand,{stackBB,shoveStrategy,equityMatrix,hands=all169()}){
 const b=normalizeHandClass(hand),S=Number(stackBB);if(!(S>1))throw new Error('stack_must_exceed_1bb');
 let reach=0,call=0;
 for(const h of hands){const w=compatibleComboCount(h,b)*clamp01(shoveStrategy[h]);if(w<=0)continue;reach+=w;const eqBB=1-matrixEq(equityMatrix,h,b);call+=w*(S*(2*eqBB-1))}
 return{reachWeight:reach,callEV:reach?call/reach:-1,foldEV:-1};
}

export function expectedSbValue({stackBB,shoveStrategy,callStrategy,equityMatrix,hands=all169()}){
 let jointWeight=0,total=0;
 for(const h of hands)for(const b of hands){const w=compatibleComboCount(h,b);if(!w)continue;jointWeight+=w;const s=clamp01(shoveStrategy[h]),c=clamp01(callStrategy[b]);const fold=-0.5,show=stackBB*(2*matrixEq(equityMatrix,h,b)-1);const shove=(1-c)*1+c*show;total+=w*((1-s)*fold+s*shove)}
 return jointWeight?total/jointWeight:0;
}

export function bestResponseShoveStrategy({stackBB,callStrategy,equityMatrix,hands=all169()}){
 const out={};for(const h of hands)out[h]=shoveActionEV(h,{stackBB,callStrategy,equityMatrix,hands})>-0.5?1:0;return out;
}
export function bestResponseCallStrategy({stackBB,shoveStrategy,equityMatrix,hands=all169()}){
 const out={};for(const b of hands){const x=bbCallActionEV(b,{stackBB,shoveStrategy,equityMatrix,hands});out[b]=x.reachWeight>0&&x.callEV>-1?1:0}return out;
}

export function solveHuPushFold({stackBB,equityMatrix,hands=all169(),iterations=12000,burnIn=1000}={}){
 const hs=[...new Set(hands.map(normalizeHandClass).filter(Boolean))];if(!hs.length)throw new Error('hands_empty');
 for(const h of hs){if(!Number.isFinite(comboCountForClass(h)))throw new Error(`bad_hand:${h}`)}
 const regretsSB=Object.fromEntries(hs.map(h=>[h,[0,0]])),regretsBB=Object.fromEntries(hs.map(h=>[h,[0,0]]));
 const avgSB=Object.fromEntries(hs.map(h=>[h,0])),avgBB=Object.fromEntries(hs.map(h=>[h,0]));let avgN=0;
 for(let t=0;t<iterations;t++){
  const sb={},bb={};for(const h of hs){sb[h]=regretStrategy(...regretsSB[h]);bb[h]=regretStrategy(...regretsBB[h])}
  for(const h of hs){const fold=-0.5,shove=shoveActionEV(h,{stackBB,callStrategy:bb,equityMatrix,hands:hs}),mix=(1-sb[h])*fold+sb[h]*shove;regretsSB[h][0]+=fold-mix;regretsSB[h][1]+=shove-mix}
  for(const b of hs){const x=bbCallActionEV(b,{stackBB,shoveStrategy:sb,equityMatrix,hands:hs});if(x.reachWeight<=0)continue;const mix=(1-bb[b])*x.foldEV+bb[b]*x.callEV;const reach=x.reachWeight/compatibleUniverse(b,hs);regretsBB[b][0]+=reach*(x.foldEV-mix);regretsBB[b][1]+=reach*(x.callEV-mix)}
  if(t>=burnIn){avgN++;for(const h of hs){avgSB[h]+=sb[h];avgBB[h]+=bb[h]}}
 }
 const shoveStrategy={},callStrategy={};for(const h of hs){shoveStrategy[h]=avgN?avgSB[h]/avgN:0.5;callStrategy[h]=avgN?avgBB[h]/avgN:0.5}
 const value=expectedSbValue({stackBB,shoveStrategy,callStrategy,equityMatrix,hands:hs});
 const brSB=bestResponseShoveStrategy({stackBB,callStrategy,equityMatrix,hands:hs});
 const brBB=bestResponseCallStrategy({stackBB,shoveStrategy,equityMatrix,hands:hs});
 const brSbValue=expectedSbValue({stackBB,shoveStrategy:brSB,callStrategy,equityMatrix,hands:hs});
 const brBbValue=-expectedSbValue({stackBB,shoveStrategy,callStrategy:brBB,equityMatrix,hands:hs});
 return{game:'HU_PUSH_FOLD',stackBB:Number(stackBB),iterations:Number(iterations),burnIn:Number(burnIn),hands:hs,shoveStrategy,callStrategy,valueSB:value,valueBB:-value,bestResponseValueSB:brSbValue,bestResponseValueBB:brBbValue,nashConv:brSbValue+brBbValue};
}
