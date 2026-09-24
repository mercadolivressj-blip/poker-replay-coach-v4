import {all169,normalizeHandClass} from '../core/hand-class.js';
import {solvePushFoldGame} from './pushfold-game.js';
import {solvePushFoldFictitiousPlay} from './pushfold-fictitious-play.js';

function diffStats(a,b,hands){
 let sum=0,max=0,maxHand=null;
 for(const h of hands){const d=Math.abs(Number(a[h]||0)-Number(b[h]||0));sum+=d;if(d>max){max=d;maxHand=h}}
 return{meanAbsDiff:hands.length?sum/hands.length:0,maxAbsDiff:max,maxDiffHand:maxHand};
}

export function solvePushFoldConsensus({game,equityMatrix,hands=all169(),regretIterations=12000,burnIn=1000,fictitiousIterations=8000,maxNashConv=.02,maxMeanFrequencyDiff=.04,maxFrequencyDiff=.15}={}){
 const hs=[...new Set(hands.map(normalizeHandClass).filter(Boolean))];
 const regret=solvePushFoldGame({game,equityMatrix,hands:hs,iterations:regretIterations,burnIn});
 const fictitious=solvePushFoldFictitiousPlay({game,equityMatrix,hands:hs,iterations:fictitiousIterations});
 const shove=diffStats(regret.shoveStrategy,fictitious.shoveStrategy,hs),call=diffStats(regret.callStrategy,fictitious.callStrategy,hs);
 const thresholds={maxNashConv:Number(maxNashConv),maxMeanFrequencyDiff:Number(maxMeanFrequencyDiff),maxFrequencyDiff:Number(maxFrequencyDiff)};
 const checks={
  regretConverged:regret.nashConv<=thresholds.maxNashConv,
  fictitiousConverged:fictitious.nashConv<=thresholds.maxNashConv,
  shoveMeanAgreement:shove.meanAbsDiff<=thresholds.maxMeanFrequencyDiff,
  callMeanAgreement:call.meanAbsDiff<=thresholds.maxMeanFrequencyDiff,
  shoveMaxAgreement:shove.maxAbsDiff<=thresholds.maxFrequencyDiff,
  callMaxAgreement:call.maxAbsDiff<=thresholds.maxFrequencyDiff
 };
 const solverConsensus=Object.values(checks).every(Boolean);
 return{version:'pushfold-consensus-v1',hands:hs.length,regret,fictitious,agreement:{shove,call},thresholds,checks,solverConsensus,recommendedCertification:solverConsensus?'solver-verified':'solver-derived'};
}
