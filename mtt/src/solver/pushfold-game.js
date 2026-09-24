import {all169,normalizeHandClass} from '../core/hand-class.js';
import {compatibleComboCount} from '../math/class-equity.js';

const EPS=1e-12;
const clamp01=x=>Math.max(0,Math.min(1,Number(x)||0));
const matrixEq=(m,a,b)=>{const e=m?.[a]?.[b];if(!Number.isFinite(e))throw new Error(`equity_missing:${a}:${b}`);return e};

export function normalizePushFoldGame(spec={}){
 const S=Number(spec.effectiveStackBB??spec.stackBB);
 const heroForced=Number(spec.heroForcedBB??0.5),villainForced=Number(spec.villainForcedBB??1),dead=Number(spec.deadMoneyBB??0);
 if(!(S>0)||heroForced<0||villainForced<0||dead<0)throw new Error('pushfold_game_invalid');
 if(heroForced>=S||villainForced>=S)throw new Error('forced_bet_must_be_below_stack');
 const heroAdditional=S-heroForced,villainAdditional=S-villainForced;
 const potBefore=heroForced+villainForced+dead,showdownPot=potBefore+heroAdditional+villainAdditional;
 return Object.freeze({effectiveStackBB:S,heroForcedBB:heroForced,villainForcedBB:villainForced,deadMoneyBB:dead,heroAdditionalBB:heroAdditional,villainAdditionalBB:villainAdditional,potBeforeBB:potBefore,showdownPotBB:showdownPot,sbFoldGainBB:villainForced+dead});
}

function compatibleUniverse(hero,hands){return hands.reduce((s,v)=>s+compatibleComboCount(hero,v),0)}
function regretStrategy(rFold,rAgg){const a=Math.max(0,rFold),b=Math.max(0,rAgg),s=a+b;return s>EPS?b/s:0.5}

export function sbShoveEVIncrement(hand,{game,callStrategy,equityMatrix,hands=all169()}){
 const g=normalizePushFoldGame(game),h=normalizeHandClass(hand);let total=0,ev=0;
 for(const v of hands){const w=compatibleComboCount(h,v);if(!w)continue;total+=w;const c=clamp01(callStrategy[v]);
  const show=matrixEq(equityMatrix,h,v)*g.showdownPotBB-g.heroAdditionalBB;
  ev+=w*((1-c)*g.sbFoldGainBB+c*show);
 }
 return total?ev/total:0;
}

export function bbCallEVIncrement(hand,{game,shoveStrategy,equityMatrix,hands=all169()}){
 const g=normalizePushFoldGame(game),b=normalizeHandClass(hand);let reach=0,ev=0;
 for(const h of hands){const w=compatibleComboCount(h,b)*clamp01(shoveStrategy[h]);if(w<=0)continue;reach+=w;
  const eqBB=1-matrixEq(equityMatrix,h,b),call=eqBB*g.showdownPotBB-g.villainAdditionalBB;ev+=w*call;
 }
 return{reachWeight:reach,callEV:reach?ev/reach:0,foldEV:0};
}

export function profileValueSB({game,shoveStrategy,callStrategy,equityMatrix,hands=all169()}){
 const g=normalizePushFoldGame(game);let joint=0,total=0;
 for(const h of hands)for(const b of hands){const w=compatibleComboCount(h,b);if(!w)continue;joint+=w;
  const s=clamp01(shoveStrategy[h]),c=clamp01(callStrategy[b]),show=matrixEq(equityMatrix,h,b)*g.showdownPotBB-g.heroAdditionalBB;
  const shove=(1-c)*g.sbFoldGainBB+c*show;total+=w*s*shove;
 }
 return joint?total/joint:0;
}

export function bestResponseShove({game,callStrategy,equityMatrix,hands=all169()}){
 const out={};for(const h of hands)out[h]=sbShoveEVIncrement(h,{game,callStrategy,equityMatrix,hands})>0?1:0;return out;
}
export function bestResponseCall({game,shoveStrategy,equityMatrix,hands=all169()}){
 const out={};for(const b of hands){const x=bbCallEVIncrement(b,{game,shoveStrategy,equityMatrix,hands});out[b]=x.reachWeight>0&&x.callEV>0?1:0}return out;
}

export function verifyPushFoldProfile({game,shoveStrategy,callStrategy,equityMatrix,hands=all169()}){
 const hs=[...new Set(hands.map(normalizeHandClass).filter(Boolean))],valueSB=profileValueSB({game,shoveStrategy,callStrategy,equityMatrix,hands:hs});
 const brS=bestResponseShove({game,callStrategy,equityMatrix,hands:hs}),brC=bestResponseCall({game,shoveStrategy,equityMatrix,hands:hs});
 const brSB=profileValueSB({game,shoveStrategy:brS,callStrategy,equityMatrix,hands:hs});
 const valueVsBrBB=profileValueSB({game,shoveStrategy,callStrategy:brC,equityMatrix,hands:hs});
 const sbGain=Math.max(0,brSB-valueSB),bbGain=Math.max(0,valueSB-valueVsBrBB);
 return{valueSB,bestResponseValueSB:brSB,valueSBvsBestResponseBB:valueVsBrBB,sbExploitability:sbGain,bbExploitability:bbGain,nashConv:sbGain+bbGain};
}

export function solvePushFoldGame({game,equityMatrix,hands=all169(),iterations=12000,burnIn=1000}={}){
 const g=normalizePushFoldGame(game),hs=[...new Set(hands.map(normalizeHandClass).filter(Boolean))];if(!hs.length)throw new Error('hands_empty');
 const regretsSB=Object.fromEntries(hs.map(h=>[h,[0,0]])),regretsBB=Object.fromEntries(hs.map(h=>[h,[0,0]]));
 const avgSB=Object.fromEntries(hs.map(h=>[h,0])),avgBB=Object.fromEntries(hs.map(h=>[h,0]));let avgN=0;
 for(let t=0;t<iterations;t++){
  const sb={},bb={};for(const h of hs){sb[h]=regretStrategy(...regretsSB[h]);bb[h]=regretStrategy(...regretsBB[h])}
  for(const h of hs){const fold=0,shove=sbShoveEVIncrement(h,{game:g,callStrategy:bb,equityMatrix,hands:hs}),mix=(1-sb[h])*fold+sb[h]*shove;regretsSB[h][0]+=fold-mix;regretsSB[h][1]+=shove-mix}
  for(const b of hs){const x=bbCallEVIncrement(b,{game:g,shoveStrategy:sb,equityMatrix,hands:hs});if(x.reachWeight<=0)continue;const mix=bb[b]*x.callEV;const reach=x.reachWeight/compatibleUniverse(b,hs);regretsBB[b][0]+=reach*(0-mix);regretsBB[b][1]+=reach*(x.callEV-mix)}
  if(t>=burnIn){avgN++;for(const h of hs){avgSB[h]+=sb[h];avgBB[h]+=bb[h]}}
 }
 const shoveStrategy={},callStrategy={};for(const h of hs){shoveStrategy[h]=avgN?avgSB[h]/avgN:0.5;callStrategy[h]=avgN?avgBB[h]/avgN:0.5}
 const verification=verifyPushFoldProfile({game:g,shoveStrategy,callStrategy,equityMatrix,hands:hs});
 return{game:'GENERIC_PUSH_FOLD',gameSpec:g,iterations:Number(iterations),burnIn:Number(burnIn),hands:hs,shoveStrategy,callStrategy,...verification};
}
