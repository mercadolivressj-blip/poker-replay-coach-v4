import {all169} from '../core/hand-class.js';

const SHA=/^[a-f0-9]{64}$/i;
const pct=x=>Math.max(0,Math.min(100,Number(x||0)*100));
function twoWay(aggressive,passive,frequency){
 const a=pct(frequency),p=100-a;
 if(a<=1e-9)return{[passive]:100};
 if(p<=1e-9)return{[aggressive]:100};
 return{[passive]:p,[aggressive]:a};
}
function assertProfileCoverage(profile,{requireFull169=true}={}){
 const hands=all169(),missing=[],invalid=[];
 for(const h of hands){
  for(const [label,map] of [['shove',profile?.shoveStrategy],['call',profile?.callStrategy]]){
   const v=Number(map?.[h]);
   if(map?.[h]==null){missing.push(`${label}:${h}`);continue}
   if(!Number.isFinite(v)||v<0||v>1)invalid.push(`${label}:${h}:${map?.[h]}`);
  }
 }
 if(requireFull169&&missing.length)throw new Error(`pushfold_pack_builder_incomplete_169:${missing.slice(0,8).join(',')}:${missing.length}`);
 if(invalid.length)throw new Error(`pushfold_pack_builder_invalid_frequency:${invalid.slice(0,8).join(',')}`);
 return{complete169:missing.length===0,missingCount:missing.length};
}
function assertSnapshotBound(consensus,snapshotSha256,{promoteVerified}={}){
 if(!promoteVerified)return;
 const shas=consensus?.equityAudit?.snapshotShas;
 if(!Array.isArray(shas)||!shas.length)throw new Error('pushfold_pack_builder_verified_requires_audit_snapshot_shas');
 if(!shas.map(x=>String(x).toLowerCase()).includes(snapshotSha256))throw new Error('pushfold_pack_builder_snapshot_not_in_equity_audit');
}

export function buildBlindVsBlindPushFoldPacks({consensus,preflopContext,effectiveStackBB,equitySnapshotSha256,referenceDate='2026-09-24',promoteVerified=false,engine='regret',requireFull169=true}={}){
 const S=Number(effectiveStackBB),n=Number(preflopContext?.playersDealt),snapshotSha256=String(equitySnapshotSha256||'').toLowerCase();
 if(!(S>0)||!Number.isInteger(n)||n<2||n>9)throw new Error('pushfold_pack_builder_context_invalid');
 if(!SHA.test(snapshotSha256))throw new Error('pushfold_pack_builder_snapshot_sha256_required');
 if(!consensus?.[engine]?.shoveStrategy||!consensus?.[engine]?.callStrategy)throw new Error('pushfold_pack_builder_profile_missing');
 const profile=consensus[engine],coverage=assertProfileCoverage(profile,{requireFull169});
 const verified=Boolean(promoteVerified&&consensus.verificationReady);
 if(promoteVerified&&!consensus.solverConsensus)throw new Error('pushfold_pack_builder_consensus_required');
 if(promoteVerified&&!consensus.equityStable)throw new Error('pushfold_pack_builder_equity_stability_required');
 if(promoteVerified&&!consensus.verificationReady)throw new Error('pushfold_pack_builder_verification_not_ready');
 assertSnapshotBound(consensus,snapshotSha256,{promoteVerified});
 const certification=verified?'solver-verified':'solver-derived',source=`SSJ internal dual-solver push/fold ${consensus.version||'consensus'} / ${engine}`;
 const common={game:'NLHE',format:'MTT',mode:'cEV',tableSize:n,stackDepthBB:S,depthPolicy:'exact',node:'blind_vs_blind',source,sourceType:'internal-pushfold-solver',referenceDate,certification,snapshotSha256,contextPolicy:'exact-preflop-forced',preflopContext:{...preflopContext},profileCoverage:coverage,consensus:{solverConsensus:Boolean(consensus.solverConsensus),equityStable:Boolean(consensus.equityStable),verificationReady:Boolean(consensus.verificationReady),regretNashConv:Number(consensus.regret?.nashConv),fictitiousNashConv:Number(consensus.fictitious?.nashConv),agreement:consensus.agreement,thresholds:consensus.thresholds,equityAudit:consensus.equityAudit||null}};
 const shoveChart={},callChart={};
 for(const h of all169()){
  const shove=profile.shoveStrategy[h],call=profile.callStrategy[h];
  if(shove!=null)shoveChart[h]=twoWay('ALLIN','FOLD',shove);
  if(call!=null)callChart[h]=twoWay('CALL','FOLD',call);
 }
 if(requireFull169&&(Object.keys(shoveChart).length!==169||Object.keys(callChart).length!==169))throw new Error('pushfold_pack_builder_chart_not_169');
 return{
  sb:{meta:{...common,heroPosition:'SB',villainPosition:'BB',actionSet:['FOLD','ALLIN']},chart:shoveChart},
  bb:{meta:{...common,heroPosition:'BB',villainPosition:'SB',actionSet:['FOLD','CALL']},chart:callChart}
 };
}
