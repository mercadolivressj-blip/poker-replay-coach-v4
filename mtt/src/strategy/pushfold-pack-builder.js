import {all169} from '../core/hand-class.js';

const pct=x=>Math.max(0,Math.min(100,Number(x||0)*100));
function twoWay(aggressive,passive,frequency){
 const a=pct(frequency),p=100-a;
 if(a<=1e-9)return{[passive]:100};
 if(p<=1e-9)return{[aggressive]:100};
 return{[passive]:p,[aggressive]:a};
}

export function buildBlindVsBlindPushFoldPacks({consensus,preflopContext,effectiveStackBB,referenceDate='2026-09-24',promoteVerified=false,engine='regret'}={}){
 const S=Number(effectiveStackBB),n=Number(preflopContext?.playersDealt);
 if(!(S>0)||!Number.isInteger(n)||n<2||n>9)throw new Error('pushfold_pack_builder_context_invalid');
 if(!consensus?.[engine]?.shoveStrategy||!consensus?.[engine]?.callStrategy)throw new Error('pushfold_pack_builder_profile_missing');
 const verified=Boolean(promoteVerified&&consensus.verificationReady);
 if(promoteVerified&&!consensus.solverConsensus)throw new Error('pushfold_pack_builder_consensus_required');
 if(promoteVerified&&!consensus.equityStable)throw new Error('pushfold_pack_builder_equity_stability_required');
 const certification=verified?'solver-verified':'solver-derived';
 const profile=consensus[engine],source=`SSJ internal dual-solver push/fold ${consensus.version||'consensus'} / ${engine}`;
 const common={game:'NLHE',format:'MTT',mode:'cEV',tableSize:n,stackDepthBB:S,depthPolicy:'exact',node:'blind_vs_blind',source,sourceType:'internal-pushfold-solver',referenceDate,certification,contextPolicy:'exact-preflop-forced',preflopContext:{...preflopContext},consensus:{solverConsensus:Boolean(consensus.solverConsensus),equityStable:Boolean(consensus.equityStable),verificationReady:Boolean(consensus.verificationReady),regretNashConv:Number(consensus.regret?.nashConv),fictitiousNashConv:Number(consensus.fictitious?.nashConv),agreement:consensus.agreement,thresholds:consensus.thresholds,equityAudit:consensus.equityAudit||null}};
 const shoveChart={},callChart={};
 for(const h of all169()){
  shoveChart[h]=twoWay('ALLIN','FOLD',profile.shoveStrategy[h]);
  callChart[h]=twoWay('CALL','FOLD',profile.callStrategy[h]);
 }
 return{
  sb:{meta:{...common,heroPosition:'SB',villainPosition:'BB',actionSet:['FOLD','ALLIN']},chart:shoveChart},
  bb:{meta:{...common,heroPosition:'BB',villainPosition:'SB',actionSet:['FOLD','CALL']},chart:callChart}
 };
}
