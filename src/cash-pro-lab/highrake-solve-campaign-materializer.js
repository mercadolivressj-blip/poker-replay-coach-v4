import { materializeCurrent100zSrpCampaign } from './solve-campaign-materializer.js';
import { buildHighRakePostflopFlopJob } from './highrake-postflop-job-builder.js';
import { CURRENT_100Z_SRP_TREE_PROFILE } from './solver-campaign-profile.js';

function safeName(value){return String(value||'job').replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,180);}

export function materializeCurrentHighRakeCampaign({split=null,compute={}}={}){
  const base=materializeCurrent100zSrpCampaign({split});
  const errors=[...(base.ok?[]:base.errors.map(e=>`base:${e}`))];
  const jobs=[];
  const ids=new Set();
  const outputs=new Set();
  const bySplit={train:0,dev:0,holdout:0,unknown:0};

  for(const row of base.jobs){
    const built=buildHighRakePostflopFlopJob({
      root:row.root,
      treeProfile:CURRENT_100Z_SRP_TREE_PROFILE,
      outputFile:`${row.root.fingerprint}_highrake.json`,
      compute,
    });
    if(!built.ok){errors.push(`highrake_job_failed:${row.root.fingerprint}:${built.errors.join('+')}`);continue;}
    const job=built.job;
    if(ids.has(job.providerFingerprint)){errors.push(`duplicate_provider_fingerprint:${job.providerFingerprint}`);continue;}
    ids.add(job.providerFingerprint);
    const configFile=`configs/${row.split}/${safeName(job.providerFingerprint)}.toml`;
    const outputFile=`outputs/${row.split}/${safeName(job.providerFingerprint)}.json`;
    if(outputs.has(outputFile)){errors.push(`duplicate_output:${outputFile}`);continue;}
    outputs.add(outputFile);
    jobs.push({
      version:'cash-pro-lab-highrake-campaign-job-v1',
      id:job.providerFingerprint,
      split:row.split,
      configFile,
      outputFile,
      solveRootFingerprint:row.root.fingerprint,
      solveRootFingerprintVersion:row.root.fingerprintVersion,
      abstractRootKey:row.abstractRootKey,
      abstractTexture:row.abstractTexture,
      job,
    });
    bySplit[row.split]=(bySplit[row.split]||0)+1;
  }

  return {
    version:'cash-pro-lab-highrake-solve-campaign-v1',
    ok:errors.length===0,
    errors:[...new Set(errors)],
    campaignId:`${base.campaign.campaignId}-highrake-dcfr-v1`,
    sourceCampaign:base.campaign,
    baseSummary:{
      eligibleTickets:base.planner.eligibleTickets,
      abstractRoots:base.planner.uniqueAbstractRoots,
      concreteRoots:base.materialized.jobs,
      splitIntegrity:base.planner.splitIntegrity,
    },
    materialized:{jobs:jobs.length,bySplit},
    jobs,
    authority:{
      configuredHighRakeRoots:jobs.length,
      executedRoots:0,
      validatedStrategyOracleRoots:0,
      alternativeEvOracleRoots:0,
      certifiedStudies:0,
    },
    note:'Materialization creates exact high-rake configs only. Solver execution and strategy authority remain zero until external evidence is produced and validated.',
  };
}
