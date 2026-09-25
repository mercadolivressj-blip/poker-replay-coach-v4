import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { validateHighRakePostflopSolution } from '../../src/cash-pro-lab/highrake-postflop-solution-validator.js';

export const HIGHRake_MANIFEST_VERSION='cash-pro-lab-highrake-external-manifest-v1';
export const HIGHRake_SIDECAR_VERSION='cash-pro-lab-highrake-strategy-artifact-v1';
const sha256=input=>crypto.createHash('sha256').update(input).digest('hex');

export function resolveCampaignPath(baseDir,relativePath){
  const base=path.resolve(baseDir);
  if(typeof relativePath!=='string'||!relativePath||path.isAbsolute(relativePath)) throw new Error('path_must_be_relative');
  const out=path.resolve(base,relativePath);
  const rel=path.relative(base,out);
  if(rel.startsWith('..')||path.isAbsolute(rel)) throw new Error('path_escapes_campaign');
  return out;
}

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
    if(row?.job?.convergence?.turnChanceSampling!==false) errors.push(`sampling_contract_invalid:${row?.id||'unknown'}`);
  }
  return {ok:errors.length===0,errors:[...new Set(errors)]};
}

export function buildValidatedHighRakeSidecar({row,solutionText,configText,binarySha256,startedAt,finishedAt}={}){
  const errors=[];
  let solution=null;
  try{solution=JSON.parse(String(solutionText||''));}catch{errors.push('solution_invalid_json');}
  if(typeof configText!=='string'||!configText.trim()) errors.push('config_missing');
  if(!/^[a-f0-9]{64}$/.test(String(binarySha256||''))) errors.push('binary_sha256_invalid');
  const validation=solution?validateHighRakePostflopSolution({solution,job:row?.job}):{ok:false,errors:['solution_unavailable'],authority:null};
  if(!validation.ok) errors.push(...validation.errors.map(e=>`solution:${e}`));
  if(row?.job?.configSha256!==sha256(String(configText||''))) errors.push('config_sha256_mismatch');
  if(errors.length) return {ok:false,errors:[...new Set(errors)],sidecar:null,validation};
  const outputSha256=sha256(solutionText);
  return {
    ok:true,errors:[],validation,
    sidecar:{
      version:HIGHRake_SIDECAR_VERSION,
      status:'VALIDATED_STRATEGY_ORACLE',
      certifiedStudy:false,
      strategyOracleReady:true,
      evAlternativeOracleReady:false,
      jobId:row.id,
      split:row.split,
      provider:row.job.provider,
      providerFingerprint:row.job.providerFingerprint,
      solveRootFingerprint:row.job.solveRootFingerprint,
      solveRootFingerprintVersion:row.job.solveRootFingerprintVersion,
      treeProfileKey:row.job.treeProfileKey,
      strategyProfile:row.job.strategyProfile,
      rake:{...row.job.rake},
      convergence:{...row.job.convergence,measuredExploitabilityPct:validation.authority.measuredExploitabilityPct,iterations:validation.authority.iterations},
      outputFile:row.outputFile,
      outputSha256,
      configFile:row.configFile,
      configSha256:row.job.configSha256,
      solverBinarySha256:binarySha256,
      engine:{...row.job.engine,engineVersion:solution.meta.engine_version},
      startedAt:String(startedAt||''),
      finishedAt:String(finishedAt||''),
      note:'Validated strategy oracle only. This artifact has no authority for per-action alternative EV loss and is not a certified study.',
    },
  };
}

export function validateHighRakeResume({row,solutionText,configText,binarySha256,sidecar}={}){
  const built=buildValidatedHighRakeSidecar({row,solutionText,configText,binarySha256,startedAt:sidecar?.startedAt,finishedAt:sidecar?.finishedAt});
  if(!built.ok) return {ok:false,errors:built.errors};
  const errors=[];
  for(const key of ['version','status','jobId','split','provider','providerFingerprint','solveRootFingerprint','solveRootFingerprintVersion','treeProfileKey','strategyProfile','outputFile','outputSha256','configFile','configSha256','solverBinarySha256']){
    if(JSON.stringify(sidecar?.[key])!==JSON.stringify(built.sidecar[key])) errors.push(`sidecar_${key}_mismatch`);
  }
  if(sidecar?.certifiedStudy!==false) errors.push('sidecar_certified_flag_invalid');
  if(sidecar?.strategyOracleReady!==true) errors.push('sidecar_strategy_authority_invalid');
  if(sidecar?.evAlternativeOracleReady!==false) errors.push('sidecar_ev_authority_invalid');
  if(JSON.stringify(sidecar?.rake)!==JSON.stringify(built.sidecar.rake)) errors.push('sidecar_rake_mismatch');
  return {ok:errors.length===0,errors};
}

function wait(child){return new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});}

export async function executeHighRakeJob({manifestDir,row,solverPath,dryRun=false,resume=false}={}){
  const binary=path.resolve(String(solverPath||''));
  const configPath=resolveCampaignPath(manifestDir,row.configFile);
  const outputPath=resolveCampaignPath(manifestDir,row.outputFile);
  const sidecarPath=`${outputPath}.meta.json`;
  const logBase=resolveCampaignPath(manifestDir,`logs/${row.split}/${row.id}`);
  if(!fs.existsSync(binary)) return {status:'BLOCKED',reason:'solver_binary_missing',jobId:row.id};
  if(!fs.statSync(binary).isFile()) return {status:'BLOCKED',reason:'solver_binary_not_file',jobId:row.id};
  if(!fs.existsSync(configPath)) return {status:'BLOCKED',reason:'config_file_missing',jobId:row.id};
  const configText=fs.readFileSync(configPath,'utf8');
  const binarySha256=sha256(fs.readFileSync(binary));
  if(row.job.configSha256!==sha256(configText)) return {status:'BLOCKED',reason:'config_sha256_mismatch',jobId:row.id};

  if(resume&&fs.existsSync(outputPath)&&fs.existsSync(sidecarPath)){
    try{
      const solutionText=fs.readFileSync(outputPath,'utf8');
      const sidecar=JSON.parse(fs.readFileSync(sidecarPath,'utf8'));
      const checked=validateHighRakeResume({row,solutionText,configText,binarySha256,sidecar});
      if(checked.ok) return {status:'RESUMED_VALIDATED_STRATEGY_ORACLE',jobId:row.id,outputPath,sidecarPath,binarySha256};
    }catch{/* recompute stale or malformed evidence */}
  }
  const args=['solve','--config',configPath,'--report-every',String(row.job.convergence.reportEvery),'--threads',String(row.job.convergence.threads),'--out',outputPath];
  if(dryRun) return {status:'DRY_RUN',jobId:row.id,solverPath:binary,args,configPath,outputPath,binarySha256,configSha256:row.job.configSha256};

  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.mkdirSync(path.dirname(logBase),{recursive:true});
  if(fs.existsSync(outputPath)) fs.rmSync(outputPath,{force:true});
  const stdoutPath=`${logBase}.stdout.log`,stderrPath=`${logBase}.stderr.log`;
  const stdout=fs.createWriteStream(stdoutPath,{flags:'w'}),stderr=fs.createWriteStream(stderrPath,{flags:'w'});
  const startedAt=new Date().toISOString();
  const child=spawn(binary,args,{cwd:path.dirname(binary),stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(stdout);child.stderr.pipe(stderr);
  const result=await wait(child);stdout.end();stderr.end();
  const finishedAt=new Date().toISOString();
  if(result.code!==0) return {status:'FAILED',reason:'solver_exit_nonzero',exitCode:result.code,signal:result.signal,jobId:row.id,stdoutPath,stderrPath};
  if(!fs.existsSync(outputPath)) return {status:'FAILED',reason:'solver_output_missing',jobId:row.id,stdoutPath,stderrPath};
  const solutionText=fs.readFileSync(outputPath,'utf8');
  const built=buildValidatedHighRakeSidecar({row,solutionText,configText,binarySha256,startedAt,finishedAt});
  if(!built.ok) return {status:'FAILED',reason:'solution_validation_failed',errors:built.errors,jobId:row.id,stdoutPath,stderrPath,outputPath};
  fs.writeFileSync(sidecarPath,JSON.stringify(built.sidecar,null,2));
  return {status:'VALIDATED_STRATEGY_ORACLE',jobId:row.id,outputPath,sidecarPath,stdoutPath,stderrPath,binarySha256,measuredExploitabilityPct:built.sidecar.convergence.measuredExploitabilityPct,certifiedStudy:false,evAlternativeOracleReady:false};
}
