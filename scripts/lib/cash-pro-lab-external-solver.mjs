import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const MANIFEST_VERSION='cash-pro-lab-external-solver-manifest-v1';
const SIDECAR_VERSION='cash-pro-lab-raw-solver-artifact-v2';

export function sha256Hex(input){
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function parseAndValidateRawSolverJson(rawText){
  const errors=[];
  let value=null;
  if(typeof rawText!=='string'||!rawText.trim()) errors.push('raw_output_empty');
  if(!errors.length){
    try{value=JSON.parse(rawText);}catch{errors.push('raw_output_invalid_json');}
  }
  if(!errors.length&&(value===null||Array.isArray(value)||typeof value!=='object')) errors.push('raw_output_not_object');
  if(!errors.length&&Object.keys(value).length===0) errors.push('raw_output_object_empty');
  return {ok:errors.length===0,errors,value};
}

export function buildRawArtifactSidecar({job,rawText,commandText,solverBinarySha256,startedAt,finishedAt,exitCode,solverPath}={}){
  const parsed=parseAndValidateRawSolverJson(rawText);
  if(!parsed.ok) return {ok:false,errors:parsed.errors,sidecar:null};
  const errors=[];
  if(!job?.id) errors.push('job_id_missing');
  if(!job?.solveRootFingerprint) errors.push('root_fingerprint_missing');
  if(!job?.solveRootFingerprintVersion) errors.push('root_fingerprint_version_missing');
  if(!job?.split) errors.push('split_missing');
  if(!job?.strategyProfile) errors.push('strategy_profile_missing');
  if(!job?.treeProfileKey) errors.push('tree_profile_key_missing');
  if(typeof commandText!=='string'||!commandText.trim()) errors.push('command_text_missing');
  if(!/^[a-f0-9]{64}$/.test(String(solverBinarySha256||''))) errors.push('solver_binary_sha256_missing');
  if(Number(exitCode)!==0) errors.push('solver_exit_nonzero');
  if(errors.length) return {ok:false,errors,sidecar:null};
  const bytes=Buffer.byteLength(rawText,'utf8');
  const sidecar={
    version:SIDECAR_VERSION,
    status:'RAW_SOLVER_ARTIFACT',
    certifiedStudy:false,
    validatedOracle:false,
    jobId:String(job.id),
    split:String(job.split),
    solveRootFingerprint:String(job.solveRootFingerprint),
    solveRootFingerprintVersion:String(job.solveRootFingerprintVersion),
    strategyProfile:String(job.strategyProfile),
    treeProfileKey:String(job.treeProfileKey),
    outputFile:String(job.outputFile||''),
    commandSha256:sha256Hex(commandText),
    solverBinarySha256:String(solverBinarySha256),
    bytes,
    sha256:sha256Hex(rawText),
    startedAt:String(startedAt||''),
    finishedAt:String(finishedAt||''),
    exitCode:0,
    solverBinaryBasename:path.basename(String(solverPath||'')),
    provenance:{
      execution:'external-offline-process',
      autoDownloaded:false,
      binaryBundled:false,
      note:'RAW_SOLVER_ARTIFACT means JSON was produced by the exact hashed external process from the exact hashed command file and passed only envelope/integrity checks. It is not yet a validated oracle or certified study.',
    },
  };
  return {ok:true,errors:[],sidecar};
}

export function validateResumeArtifact({job,rawText,commandText,solverBinarySha256,sidecar}={}){
  const errors=[];
  const parsed=parseAndValidateRawSolverJson(rawText);
  errors.push(...parsed.errors);
  if(sidecar?.version!==SIDECAR_VERSION) errors.push('sidecar_version_invalid');
  if(sidecar?.status!=='RAW_SOLVER_ARTIFACT') errors.push('sidecar_status_invalid');
  if(sidecar?.certifiedStudy!==false) errors.push('sidecar_certification_flag_invalid');
  if(sidecar?.validatedOracle!==false) errors.push('sidecar_oracle_flag_invalid');
  if(String(sidecar?.jobId||'')!==String(job?.id||'')) errors.push('sidecar_job_mismatch');
  if(String(sidecar?.split||'')!==String(job?.split||'')) errors.push('sidecar_split_mismatch');
  if(String(sidecar?.solveRootFingerprint||'')!==String(job?.solveRootFingerprint||'')) errors.push('sidecar_root_mismatch');
  if(String(sidecar?.solveRootFingerprintVersion||'')!==String(job?.solveRootFingerprintVersion||'')) errors.push('sidecar_root_version_mismatch');
  if(String(sidecar?.strategyProfile||'')!==String(job?.strategyProfile||'')) errors.push('sidecar_strategy_profile_mismatch');
  if(String(sidecar?.treeProfileKey||'')!==String(job?.treeProfileKey||'')) errors.push('sidecar_tree_profile_mismatch');
  if(String(sidecar?.outputFile||'')!==String(job?.outputFile||'')) errors.push('sidecar_output_file_mismatch');
  if(typeof rawText==='string'&&sidecar?.sha256!==sha256Hex(rawText)) errors.push('sidecar_sha256_mismatch');
  if(typeof commandText!=='string'||!commandText.trim()) errors.push('resume_command_text_missing');
  else if(sidecar?.commandSha256!==sha256Hex(commandText)) errors.push('sidecar_command_sha256_mismatch');
  if(!/^[a-f0-9]{64}$/.test(String(solverBinarySha256||''))) errors.push('resume_solver_binary_sha256_missing');
  else if(sidecar?.solverBinarySha256!==solverBinarySha256) errors.push('sidecar_solver_binary_sha256_mismatch');
  return {ok:errors.length===0,errors:[...new Set(errors)]};
}

export function validateExternalSolverManifest(manifest={}){
  const errors=[];
  if(manifest?.version!==MANIFEST_VERSION) errors.push('manifest_version_invalid');
  if(!manifest?.campaign?.campaignId) errors.push('campaign_id_missing');
  if(!Array.isArray(manifest?.jobs)||!manifest.jobs.length) errors.push('manifest_jobs_missing');
  const ids=new Set();
  const outputs=new Set();
  for(const job of Array.isArray(manifest?.jobs)?manifest.jobs:[]){
    if(!job?.id) errors.push('job_id_missing');
    else if(ids.has(job.id)) errors.push(`duplicate_job_id:${job.id}`); else ids.add(job.id);
    if(!['train','dev','holdout'].includes(job?.split)) errors.push(`job_split_invalid:${job?.id||'unknown'}`);
    if(!job?.commandFile) errors.push(`command_file_missing:${job?.id||'unknown'}`);
    if(!job?.outputFile) errors.push(`output_file_missing:${job?.id||'unknown'}`);
    else if(outputs.has(job.outputFile)) errors.push(`duplicate_output_file:${job.outputFile}`); else outputs.add(job.outputFile);
    if(!job?.solverOutputBasename||path.basename(job.solverOutputBasename)!==job.solverOutputBasename) errors.push(`solver_output_basename_invalid:${job?.id||'unknown'}`);
    if(!job?.solveRootFingerprint) errors.push(`root_fingerprint_missing:${job?.id||'unknown'}`);
    if(!job?.strategyProfile) errors.push(`strategy_profile_missing:${job?.id||'unknown'}`);
    if(!job?.treeProfileKey) errors.push(`tree_profile_key_missing:${job?.id||'unknown'}`);
  }
  return {ok:errors.length===0,errors:[...new Set(errors)]};
}

export function resolveInside(baseDir,relativePath){
  const base=path.resolve(baseDir);
  if(typeof relativePath!=='string'||!relativePath||path.isAbsolute(relativePath)) throw new Error('path_must_be_relative');
  const resolved=path.resolve(base,relativePath);
  const rel=path.relative(base,resolved);
  if(rel.startsWith('..')||path.isAbsolute(rel)) throw new Error('path_escapes_campaign');
  return resolved;
}

function waitForChild(child){
  return new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',(code,signal)=>resolve({code,signal}));
  });
}

export async function executeExternalSolverJob({manifestDir,job,solverPath,dryRun=false,resume=false}={}){
  const absoluteSolver=path.resolve(String(solverPath||''));
  const solverDir=path.dirname(absoluteSolver);
  const commandPath=resolveInside(manifestDir,job.commandFile);
  const outputPath=resolveInside(manifestDir,job.outputFile);
  const sidecarPath=`${outputPath}.meta.json`;
  const logBase=resolveInside(manifestDir,`logs/${job.split}/${job.id}`);
  const stdoutPath=`${logBase}.stdout.log`;
  const stderrPath=`${logBase}.stderr.log`;
  const solverOutputPath=path.join(solverDir,job.solverOutputBasename);

  if(!fs.existsSync(commandPath)) return {status:'BLOCKED',reason:'command_file_missing',jobId:job.id};
  if(!fs.existsSync(absoluteSolver)) return {status:'BLOCKED',reason:'solver_binary_missing',jobId:job.id};
  if(!fs.statSync(absoluteSolver).isFile()) return {status:'BLOCKED',reason:'solver_binary_not_file',jobId:job.id};
  const commandText=fs.readFileSync(commandPath,'utf8');
  const solverBinarySha256=sha256Hex(fs.readFileSync(absoluteSolver));

  if(resume&&fs.existsSync(outputPath)&&fs.existsSync(sidecarPath)){
    try{
      const rawText=fs.readFileSync(outputPath,'utf8');
      const sidecar=JSON.parse(fs.readFileSync(sidecarPath,'utf8'));
      const checked=validateResumeArtifact({job,rawText,commandText,solverBinarySha256,sidecar});
      if(checked.ok) return {status:'RESUMED',jobId:job.id,outputPath,sidecarPath,sha256:sidecar.sha256,solverBinarySha256,commandSha256:sidecar.commandSha256};
    }catch{/* stale or malformed evidence must be recomputed */}
  }

  if(dryRun){
    return {status:'DRY_RUN',jobId:job.id,commandPath,solverPath:absoluteSolver,cwd:solverDir,outputPath,solverBinarySha256,commandSha256:sha256Hex(commandText)};
  }

  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.mkdirSync(path.dirname(stdoutPath),{recursive:true});
  if(fs.existsSync(solverOutputPath)) fs.rmSync(solverOutputPath,{force:true});

  const startedAt=new Date().toISOString();
  const stdout=fs.createWriteStream(stdoutPath,{flags:'w'});
  const stderr=fs.createWriteStream(stderrPath,{flags:'w'});
  const child=spawn(absoluteSolver,['-i',commandPath],{cwd:solverDir,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const result=await waitForChild(child);
  stdout.end();stderr.end();
  const finishedAt=new Date().toISOString();

  if(result.code!==0){
    return {status:'FAILED',reason:'solver_exit_nonzero',jobId:job.id,exitCode:result.code,signal:result.signal,stdoutPath,stderrPath};
  }
  if(!fs.existsSync(solverOutputPath)){
    return {status:'FAILED',reason:'solver_output_missing',jobId:job.id,stdoutPath,stderrPath};
  }
  const rawText=fs.readFileSync(solverOutputPath,'utf8');
  const sidecarResult=buildRawArtifactSidecar({job,rawText,commandText,solverBinarySha256,startedAt,finishedAt,exitCode:result.code,solverPath:absoluteSolver});
  if(!sidecarResult.ok){
    return {status:'FAILED',reason:'raw_artifact_invalid',errors:sidecarResult.errors,jobId:job.id,stdoutPath,stderrPath};
  }
  fs.copyFileSync(solverOutputPath,outputPath);
  fs.writeFileSync(sidecarPath,JSON.stringify(sidecarResult.sidecar,null,2));
  fs.rmSync(solverOutputPath,{force:true});
  return {status:'RAW_SOLVER_ARTIFACT',jobId:job.id,outputPath,sidecarPath,stdoutPath,stderrPath,sha256:sidecarResult.sidecar.sha256,solverBinarySha256,commandSha256:sidecarResult.sidecar.commandSha256,certifiedStudy:false};
}

export const EXTERNAL_SOLVER_MANIFEST_VERSION=MANIFEST_VERSION;
export const RAW_SOLVER_ARTIFACT_SIDECAR_VERSION=SIDECAR_VERSION;
