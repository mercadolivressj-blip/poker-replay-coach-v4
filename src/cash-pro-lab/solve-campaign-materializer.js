import { iterateStrategicCurriculum } from './strategic-curriculum.js';
import { planReusableSolveRoots } from './solve-root-planner.js';
import { materializeFlopBoard } from './board-factory.js';
import { create100zSrpFlopSolveRoot, prove100zSrpFlopSolveRoot } from './solve-root.js';
import { RANGE_PROFILE_100Z_SRP } from './range-profile-100z.js';
import { resolvePreflopMatchup } from './preflop-model-profile.js';
import { buildTexasSolverFlopJob } from './texassolver-job-builder.js';
import {
  CURRENT_100Z_SRP_CAMPAIGN_PROFILE,
  CURRENT_100Z_SRP_PREFLOP_MODEL,
  CURRENT_100Z_SRP_PREFLOP_MODEL_KEY,
  CURRENT_100Z_SRP_TREE_PROFILE,
} from './solver-campaign-profile.js';

function oneSplit(root){
  const present=Object.entries(root?.splits||{}).filter(([,count])=>Number(count)>0).map(([split])=>split);
  return present.length===1?present[0]:null;
}
function safeName(value){return String(value||'job').replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,180);}

export function materializeCurrent100zSrpCampaign({split=null}={}){
  const plan=planReusableSolveRoots(iterateStrategicCurriculum({lanes:['postflop-heads-up']}));
  const errors=[];
  if(plan.valid!==true) errors.push('planner_split_integrity_failed');
  const jobs=[];
  const concrete=new Map();
  const bySplit={train:0,dev:0,holdout:0,unknown:0};

  for(const abstractRoot of plan.roots){
    const assignedSplit=oneSplit(abstractRoot);
    if(!assignedSplit){errors.push(`root_split_invalid:${abstractRoot.key}`);continue;}
    if(split&&assignedSplit!==split) continue;
    const economics=resolvePreflopMatchup(CURRENT_100Z_SRP_PREFLOP_MODEL,abstractRoot.openerPosition,abstractRoot.defenderPosition);
    if(!economics){errors.push(`economics_missing:${abstractRoot.key}`);continue;}
    const boardResult=materializeFlopBoard({
      textureClass:abstractRoot.textureClass,
      seed:`${CURRENT_100Z_SRP_CAMPAIGN_PROFILE.campaignId}|${abstractRoot.key}|${abstractRoot.sampleSeed}`,
    });
    if(!boardResult.ok){errors.push(`board_failed:${abstractRoot.key}:${boardResult.errors.join('+')}`);continue;}
    const root=create100zSrpFlopSolveRoot({
      board:boardResult.board,
      openerPosition:abstractRoot.openerPosition,
      defenderPosition:abstractRoot.defenderPosition,
      startingStackBB:100,
      effectiveStackBB:economics.effectiveStackBB,
      potBB:economics.potBB,
      rakeProfile:RANGE_PROFILE_100Z_SRP.rakeProfile,
      strategyProfile:RANGE_PROFILE_100Z_SRP.profileId,
      preflopModelProfile:CURRENT_100Z_SRP_PREFLOP_MODEL_KEY,
      sourceRef:`${CURRENT_100Z_SRP_CAMPAIGN_PROFILE.campaignId}|${abstractRoot.key}|${economics.sourceRef}`,
    });
    const proof=prove100zSrpFlopSolveRoot(root);
    if(!proof.ok){errors.push(`root_proof_failed:${abstractRoot.key}:${proof.errors.join('+')}`);continue;}
    const outputFile=safeName(`${CURRENT_100Z_SRP_CAMPAIGN_PROFILE.campaignId}_${assignedSplit}_${root.fingerprint}.json`);
    const built=buildTexasSolverFlopJob({root,treeProfile:CURRENT_100Z_SRP_TREE_PROFILE,outputFile});
    if(!built.ok){errors.push(`job_build_failed:${abstractRoot.key}:${built.errors.join('+')}`);continue;}

    const existing=concrete.get(root.fingerprint);
    if(existing){
      existing.abstractRootKeys.push(abstractRoot.key);
      existing.abstractTextures.push(abstractRoot.textureClass);
      existing.splits.add(assignedSplit);
      continue;
    }
    const row={
      version:'cash-pro-lab-materialized-solve-job-v1',
      campaignId:CURRENT_100Z_SRP_CAMPAIGN_PROFILE.campaignId,
      split:assignedSplit,
      abstractRootKey:abstractRoot.key,
      abstractTexture:abstractRoot.textureClass,
      abstractSampleIndex:abstractRoot.sampleIndex,
      abstractSampleSeed:abstractRoot.sampleSeed,
      board:boardResult,
      economics:{
        openerPosition:economics.openerPosition,
        defenderPosition:economics.defenderPosition,
        openSizeBB:economics.openSizeBB,
        potBB:economics.potBB,
        effectiveStackBB:economics.effectiveStackBB,
        sourceRef:economics.sourceRef,
      },
      root,
      rootProof:proof,
      job:built.job,
      commandFile:`commands/${assignedSplit}/${safeName(root.fingerprint)}.txt`,
      outputFile:`outputs/${assignedSplit}/${outputFile}`,
      abstractRootKeys:[abstractRoot.key],
      abstractTextures:[abstractRoot.textureClass],
      splits:new Set([assignedSplit]),
    };
    concrete.set(root.fingerprint,row);
    jobs.push(row);
    bySplit[assignedSplit]=(bySplit[assignedSplit]||0)+1;
  }

  const concreteSplitLeakage=[];
  for(const row of jobs){
    if(row.splits.size!==1) concreteSplitLeakage.push(row.root.fingerprint);
    row.splits=[...row.splits];
  }
  if(concreteSplitLeakage.length) errors.push('concrete_root_split_leakage');
  const duplicateAbstractReferences=jobs.reduce((sum,row)=>sum+Math.max(0,row.abstractRootKeys.length-1),0);

  return {
    version:'cash-pro-lab-materialized-solve-campaign-v1',
    ok:errors.length===0,
    errors:[...new Set(errors)],
    campaign:CURRENT_100Z_SRP_CAMPAIGN_PROFILE,
    planner:{
      version:plan.version,
      valid:plan.valid,
      uniqueAbstractRoots:plan.uniqueSolveRoots,
      eligibleTickets:plan.eligibleTickets,
      compressionRatio:plan.compressionRatio,
      splitIntegrity:{...plan.splitIntegrity,valid:plan.valid},
    },
    materialized:{
      jobs:jobs.length,
      bySplit,
      duplicateAbstractReferences,
      concreteSplitLeakage,
    },
    jobs,
    note:'A materialized job is still not a certified study. Certification begins only after an external solver result is ingested, validated and independently audited.',
  };
}
