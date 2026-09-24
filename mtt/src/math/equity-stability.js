import {all169,normalizeHandClass} from '../core/hand-class.js';

function val(run,a,b){const x=Number(run?.matrix?.[a]?.[b]??run?.[a]?.[b]);if(!Number.isFinite(x))throw new Error(`equity_stability_missing:${a}:${b}`);return x}

export function auditEquityMatrixReplicates({runs,hands=all169(),maxMeanAbsDiff=.012,maxMaxAbsDiff=.04}={}){
 if(!Array.isArray(runs)||runs.length<2)throw new Error('equity_stability_requires_2_runs');
 const hs=[...new Set(hands.map(normalizeHandClass).filter(Boolean))];if(!hs.length)throw new Error('hands_empty');
 let pairs=0,sumPairRange=0,maxPairRange=0,maxPair=null;
 for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++){
  const a=hs[i],b=hs[j],xs=runs.map(r=>val(r,a,b));
  const range=Math.max(...xs)-Math.min(...xs);pairs++;sumPairRange+=range;
  if(range>maxPairRange){maxPairRange=range;maxPair=`${a}:${b}`}
 }
 const meanPairRange=pairs?sumPairRange/pairs:0;
 const thresholds={maxMeanAbsDiff:Number(maxMeanAbsDiff),maxMaxAbsDiff:Number(maxMaxAbsDiff)};
 const checks={meanStable:meanPairRange<=thresholds.maxMeanAbsDiff,maxStable:maxPairRange<=thresholds.maxMaxAbsDiff};
 return{version:'equity-stability-v1',replicates:runs.length,hands:hs.length,pairs,meanPairRange,maxPairRange,maxPair,thresholds,checks,stable:Object.values(checks).every(Boolean)};
}

export function equityAuditFixture(stable=true){
 return stable?{version:'equity-stability-fixture',stable:true,checks:{meanStable:true,maxStable:true}}:{version:'equity-stability-fixture',stable:false,checks:{meanStable:false,maxStable:false}};
}
