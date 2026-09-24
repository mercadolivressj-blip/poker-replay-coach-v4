import {all169,normalizeHandClass} from '../core/hand-class.js';
import {comboCountForClass} from '../math/range-combos.js';
import {compatibleComboCount} from '../math/class-equity.js';

const EPS=1e-12;
function regretStrategy(rFold,rAgg){const a=Math.max(0,rFold),b=Math.max(0,rAgg),s=a+b;return s>EPS?b/s:0.5}
function clamp01(x){return Math.max(0,Math.min(1,Number(x)||0))}
function matrixEq(matrix,a,b){const e=matrix?.[a]?.[b];if(!Number.isFinite(e))throw new Error(`equity_missing:${a}:${b}`);return e}

export function buildPushFoldCache(hands=all169()){
 const hs=[...new Set(hands.map(normalizeHandClass).filter(Boolean))];if(!hs.length)throw new Error('hands_empty');
 const compat={},denom={};
 for(const h of hs){compat[h]={};denom[h]=0;for(const v of hs){const w=compatibleComboCount(h,v);compat[h][v]=w;denom[h]+=w}}
 return{hands:hs,compat,denom};
}

function shoveEVCached(h,{stackBB,callStrategy,equityMatrix,cache}){
 const S=Number(stackBB);let ev=0,total=cache.denom[h];
 for(const v of cache.hands){const w=cache.compat[h][v];if(!w)continue;const c=clamp01(callStrategy[v]);const show=S*(2*matrixEq(equityMatrix,h,v)-1);ev+=w*((1-c)*1+c*show)}
 return total?ev/total:-0.5;
}
function bbCallEVCached(b,{stackBB,shoveStrategy,equityMatrix,cache}){
 const S=Number(stackBB);let reach=0,call=0;
 for(const h of cache.hands){const w=cache.compat[h][b]*clamp01(shoveStrategy[h]);if(w<=0)continue;reach+=w;const eqBB=1-matrixEq(equityMatrix,h,b);call+=w*(S*(2*eqBB-1))}
 return{reachWeight:reach,reachProbability:cache.denom[b]?reach/cache.denom[b]:0,callEV:reach?call/reach:-1,foldEV:-1};
}
function expectedSbValueCached({stackBB,shoveStrategy,callStrategy,equityMatrix,cache}){
 let jointWeight=0,total=0;
 for(const h of cache.hands)for(const b of cache.hands){const w=cache.compat[h][b];if(!w)continue;jointWeight+=w;const s=clamp01(shoveStrategy[h]),c=clamp01(callStrategy[b]);const fold=-0.5,show=stackBB*(2*matrixEq(equityMatrix,h,b)-1);const shove=(1-c)*1+c*show;total+=w*((1-s)*fold+s*shove)}
 return jointWeight?total/jointWeight:0;
}

export function shoveActionEV(hand,{stackBB,callStrategy,equityMatrix,hands=all169()}){
 const h=normalizeHandClass(hand),S=Number(stackBB);if(!(S>1))throw new Error('stack_must_exceed_1bb');
 const cache=buildPushFoldCache(hands);if(!cache.hands.includes(h))throw new Error(`hand_not_in_universe:${h}`);
 return shoveEVCached(h,{stackBB:S,callStrategy,equityMatrix,cache});
}

export function bbCallActionEV(hand,{stackBB,shoveStrategy,equityMatrix,hands=all169()}){
 const b=normalizeHandClass(hand),S=Number(stackBB);if(!(S>1))throw new Error('stack_must_exceed_1bb');
 const cache=buildPushFoldCache(hands);if(!cache.hands.includes(b))throw new Error(`hand_not_in_universe:${b}`);
 return bbCallEVCached(b,{stackBB:S,shoveStrategy,equityMatrix,cache});
}

export function expectedSbValue({stackBB,shoveStrategy,callStrategy,equityMatrix,hands=all169()}){
 const cache=buildPushFoldCache(hands);return expectedSbValueCached({stackBB,shoveStrategy,callStrategy,equityMatrix,cache});
}

export function bestResponseShoveStrategy({stackBB,callStrategy,equityMatrix,hands=all169()}){
 const cache=buildPushFoldCache(hands),out={};for(const h of cache.hands)out[h]=shoveEVCached(h,{stackBB,callStrategy,equityMatrix,cache})>-0.5?1:0;return out;
}
export function bestResponseCallStrategy({stackBB,shoveStrategy,equityMatrix,hands=all169()}){
 const cache=buildPushFoldCache(hands),out={};for(const b of cache.hands){const x=bbCallEVCached(b,{stackBB,shoveStrategy,equityMatrix,cache});out[b]=x.reachWeight>0&&x.callEV>-1?1:0}return out;
}

export function solveHuPushFold({stackBB,equityMatrix,hands=all169(),iterations=12000,burnIn=1000}={}){
 const S=Number(stackBB);if(!(S>1))throw new Error('stack_must_exceed_1bb');
 const cache=buildPushFoldCache(hands),hs=cache.hands;
 for(const h of hs){if(!Number.isFinite(comboCountForClass(h)))throw new Error(`bad_hand:${h}`)}
 const regretsSB=Object.fromEntries(hs.map(h=>[h,[0,0]])),regretsBB=Object.fromEntries(hs.map(h=>[h,[0,0]]));
 const avgSB=Object.fromEntries(hs.map(h=>[h,0])),avgBB=Object.fromEntries(hs.map(h=>[h,0]));let avgN=0;
 for(let t=0;t<iterations;t++){
  const sb={},bb={};for(const h of hs){sb[h]=regretStrategy(...regretsSB[h]);bb[h]=regretStrategy(...regretsBB[h])}
  for(const h of hs){const fold=-0.5,shove=shoveEVCached(h,{stackBB:S,callStrategy:bb,equityMatrix,cache}),mix=(1-sb[h])*fold+sb[h]*shove;regretsSB[h][0]+=fold-mix;regretsSB[h][1]+=shove-mix}
  for(const b of hs){const x=bbCallEVCached(b,{stackBB:S,shoveStrategy:sb,equityMatrix,cache});if(x.reachWeight<=0)continue;const mix=(1-bb[b])*x.foldEV+bb[b]*x.callEV;regretsBB[b][0]+=x.reachProbability*(x.foldEV-mix);regretsBB[b][1]+=x.reachProbability*(x.callEV-mix)}
  if(t>=burnIn){avgN++;for(const h of hs){avgSB[h]+=sb[h];avgBB[h]+=bb[h]}}
 }
 const shoveStrategy={},callStrategy={};for(const h of hs){shoveStrategy[h]=avgN?avgSB[h]/avgN:0.5;callStrategy[h]=avgN?avgBB[h]/avgN:0.5}
 const value=expectedSbValueCached({stackBB:S,shoveStrategy,callStrategy,equityMatrix,cache});
 const brSB={};for(const h of hs)brSB[h]=shoveEVCached(h,{stackBB:S,callStrategy,equityMatrix,cache})>-0.5?1:0;
 const brBB={};for(const b of hs){const x=bbCallEVCached(b,{stackBB:S,shoveStrategy,equityMatrix,cache});brBB[b]=x.reachWeight>0&&x.callEV>-1?1:0}
 const brSbValue=expectedSbValueCached({stackBB:S,shoveStrategy:brSB,callStrategy,equityMatrix,cache});
 const brBbValue=-expectedSbValueCached({stackBB:S,shoveStrategy,callStrategy:brBB,equityMatrix,cache});
 return{game:'HU_PUSH_FOLD',stackBB:S,iterations:Number(iterations),burnIn:Number(burnIn),hands:hs,shoveStrategy,callStrategy,valueSB:value,valueBB:-value,bestResponseValueSB:brSbValue,bestResponseValueBB:brBbValue,nashConv:brSbValue+brBbValue};
}
