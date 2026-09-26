import {
  HIGHRake_MANIFEST_VERSION,
  HIGHRake_SIDECAR_VERSION,
  archiveSolutionFile,
  buildValidatedHighRakeSidecar,
  executeHighRakeJob,
  resolveCampaignPath,
  sha256FileStreaming,
  sha256GzipContent,
  validateHighRakeResume,
} from './cash-pro-lab-highrake-runner.mjs';

export {
  HIGHRake_MANIFEST_VERSION,
  HIGHRake_SIDECAR_VERSION,
  archiveSolutionFile,
  buildValidatedHighRakeSidecar,
  executeHighRakeJob,
  resolveCampaignPath,
  sha256FileStreaming,
  sha256GzipContent,
  validateHighRakeResume,
};

export const HIGHRake_PATCH_ID='cash-pro-lab-raked-checkpoint-v2';

export function validateHighRakeManifest(manifest={}){
  const errors=[];
  if(manifest?.version!==HIGHRake_MANIFEST_VERSION) errors.push('manifest_version_invalid');
  if(!manifest?.campaignId) errors.push('campaign_id_missing');
  if(!Array.isArray(manifest?.jobs)||!manifest.jobs.length) errors.push('jobs_missing');
  const ids=new Set(),outputs=new Set(),configs=new Set();
  for(const row of Array.isArray(manifest?.jobs)?manifest.jobs:[]){
    if(!row?.id) errors.push('job_id_missing');
    else if(ids.has(row.id)) errors.push(`duplicate_job_id:${row.id}`); else ids.add(row.id);
    if(!['train','dev','holdout'].includes(row?.split)) errors.push(`split_invalid:${row?.id||'unknown'}`);
    if(!row?.configFile) errors.push(`config_file_missing:${row?.id||'unknown'}`);
    else if(configs.has(row.configFile)) errors.push(`duplicate_config_file:${row.configFile}`); else configs.add(row.configFile);
    if(!row?.outputFile) errors.push(`output_file_missing:${row?.id||'unknown'}`);
    else if(outputs.has(row.outputFile)) errors.push(`duplicate_output_file:${row.outputFile}`); else outputs.add(row.outputFile);
    if(row?.job?.provider!=='highrake-postflop-dcfr') errors.push(`provider_invalid:${row?.id||'unknown'}`);
    if(row?.job?.providerFingerprint!==row?.id) errors.push(`provider_fingerprint_mismatch:${row?.id||'unknown'}`);
    if(row?.job?.rake?.percent!==5||row?.job?.rake?.cap!==2.5) errors.push(`rake_contract_invalid:${row?.id||'unknown'}`);
    if(row?.job?.convergence?.metric!=='nashconv_pct_of_pot') errors.push(`convergence_metric_invalid:${row?.id||'unknown'}`);
    if(row?.job?.engine?.localPatch?.id!==HIGHRake_PATCH_ID) errors.push(`engine_patch_invalid:${row?.id||'unknown'}`);
    if(row?.job?.engine?.localPatch?.kind!=='deterministic-rewrite-script') errors.push(`engine_patch_kind_invalid:${row?.id||'unknown'}`);
    if(row?.job?.convergence?.turnChanceSampling!==false) errors.push(`sampling_contract_invalid:${row?.id||'unknown'}`);
  }
  return {ok:errors.length===0,errors:[...new Set(errors)]};
}
