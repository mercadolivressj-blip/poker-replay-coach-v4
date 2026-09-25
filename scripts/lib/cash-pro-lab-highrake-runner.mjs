import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { validateHighRakePostflopSolution, validateHighRakePostflopProof } from '../../src/cash-pro-lab/highrake-postflop-solution-validator.js';

export const HIGHRake_MANIFEST_VERSION='cash-pro-lab-highrake-external-manifest-v1';
export const HIGHRake_SIDECAR_VERSION='cash-pro-lab-highrake-strategy-artifact-v2';
export const HIGHRake_PATCH_ID='cash-pro-lab-raked-nashconv-v1';
const sha256=input=>crypto.createHash('sha256').update(input).digest('hex');

export function resolveCampaignPath(baseDir,relativePath){
  const base=path.resolve(baseDir);
  if(typeof relativePath!=='string'||!relativePath||path.isAbsolute(relativePath)) throw new Error('path_must_be_relative');
  const out=path.resolve(base,relativePath);
  const rel=path.relative(base,out);
  if(rel.startsWith('..')||path.isAbsolute(rel)) throw new Error('path_escapes_campaign');
  return out;
}

export async function sha256FileStreaming(file){
  const hash=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function sha256GzipContent(file){
  const hash=crypto.createHash('sha256');
  const stream=fs.createReadStream(file).pipe(zlib.createGunzip());
  for await(const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export async function archiveSolutionFile(inputFile,archiveFile=`${inputFile}.gz`){
  const outputBytes=fs.statSync(inputFile).size;
  const outputSha256=await sha256FileStreaming(inputFile);
  const tmp=`${archiveFile}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(archiveFile),{recursive:true});
  try{
    await pipeline(
      fs.createReadStream(inputFile),
      zlib.createGzip({level:1}),
      fs.createWriteStream(tmp,{flags:'wx'}),
    );
    if(fs.existsSync(archiveFile)) fs.rmSync(archiveFile,{force:true});
    fs.renameSync(tmp,archiveFile);
  }catch(error){
    if(fs.existsSync(tmp)) fs.rmSync(tmp,{force:true});
    throw error;
  }
  const archiveBytes=fs.statSync(archiveFile).size;
  const archiveSha256=await sha256FileStreaming(archiveFile);
  const decodedSha256=await sha256GzipContent(archiveFile);
  if(decodedSha256!==outputSha256){
    fs.rmSync(archiveFile,{force:true});
    throw new Error('gzip_roundtrip_sha256_mismatch');
  }
  return {outputBytes,outputSha256,archiveBytes,archiveSha256,decodedSha256,compression:{format:'gzip',level:1}};
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
    if(row?.job?.convergence?.metric!=='nashconv_pct_of_pot') errors.push(`convergence_metric_invalid:${row?.id||'unknown'}`);
    if(row?.job?.engine?.localPatch?.id!==HIGHRake_PATCH_ID) errors.push(`engine_patch_invalid:${row?.id||'unknown'}`);
    if(row?.job?.convergence?.turnChanceSampling!==false) errors.push(`sampling_contract_invalid:${row?.id||'unknown'}`);
  }
  return {ok:errors.length===0,errors:[...new Set(errors)]};
}

// Kept for small deterministic fixtures and backward-compatible unit tests only.
// Production execution below never reads a large solution into a Node string.
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
      convergence:{...row.job.convergence,measuredConvergencePct:validation.authority.measuredConvergencePct,measuredExploitabilityPct:validation.authority.measuredExploitabilityPct,iterations:validation.authority.iterations},
      outputFile:row.outputFile,
      outputSha256,
      configFile:row.configFile,
      configSha256:row.job.configSha256,
      solverBinarySha256:binarySha256,
      engine:{...row.job.engine,engineVersion:solution.meta.engine_version},
      startedAt:String(startedAt||''),
      finishedAt:String(finishedAt||''),
      note:'Small-fixture compatibility sidecar. Production artifacts use a streaming proof plus compressed archive.',
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

async function runSolutionProof({proofBinary,outputPath,proofPath}){
  if(fs.existsSync(proofPath)) fs.rmSync(proofPath,{force:true});
  const child=spawn(proofBinary,[outputPath,proofPath],{cwd:path.dirname(proofBinary),stdio:['ignore','ignore','pipe']});
  let stderr='';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk=>{if(stderr.length<65536) stderr+=chunk;});
  const result=await wait(child);
  if(result.code!==0) return {ok:false,reason:'solution_proof_failed',exitCode:result.code,signal:result.signal,stderr:stderr.trim().slice(0,65536)};
  if(!fs.existsSync(proofPath)) return {ok:false,reason:'solution_proof_missing'};
  try{return {ok:true,proof:JSON.parse(fs.readFileSync(proofPath,'utf8'))};}
  catch(error){return {ok:false,reason:'solution_proof_invalid_json',error:String(error?.message||error)};}
}

function buildStreamingSidecar({row,proof,validation,configText,binarySha256,proofBinarySha256,proofSha256,artifact,startedAt,finishedAt}={}){
  const errors=[];
  if(row?.job?.configSha256!==sha256(String(configText||''))) errors.push('config_sha256_mismatch');
  for(const [name,value] of Object.entries({binarySha256,proofBinarySha256,proofSha256,outputSha256:artifact?.outputSha256,archiveSha256:artifact?.archiveSha256})){
    if(!/^[a-f0-9]{64}$/.test(String(value||''))) errors.push(`${name}_invalid`);
  }
  if(!validation?.ok) errors.push(...(validation?.errors||['stream_validation_failed']).map(e=>`solution:${e}`));
  if(errors.length) return {ok:false,errors:[...new Set(errors)],sidecar:null};
  return {
    ok:true,errors:[],sidecar:{
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
      convergence:{...row.job.convergence,measuredConvergencePct:validation.authority.measuredConvergencePct,measuredExploitabilityPct:validation.authority.measuredExploitabilityPct,iterations:validation.authority.iterations},
      outputFile:row.outputFile,
      outputSha256:artifact.outputSha256,
      outputBytes:artifact.outputBytes,
      rawRetained:false,
      archiveFile:`${row.outputFile}.gz`,
      archiveSha256:artifact.archiveSha256,
      archiveBytes:artifact.archiveBytes,
      compression:artifact.compression,
      proofFile:`${row.outputFile}.proof.json`,
      proofSha256,
      solutionProofBinarySha256:proofBinarySha256,
      configFile:row.configFile,
      configSha256:row.job.configSha256,
      solverBinarySha256:binarySha256,
      engine:{...row.job.engine,engineVersion:proof.meta.engine_version},
      startedAt:String(startedAt||''),
      finishedAt:String(finishedAt||''),
      note:'Validated strategy oracle from bounded-memory structural proof and non-negative raked NashConv. Raw JSON is gzip-archived after SHA-256 round-trip verification. Alternative-EV and certified-study authority remain separate gates.',
    },
  };
}

async function validateAndArchiveExisting({manifestDir,row,outputPath,sidecarPath,proofPath,archivePath,configText,binarySha256,proofBinary,proofBinarySha256,startedAt,finishedAt}={}){
  const proofRun=await runSolutionProof({proofBinary,outputPath,proofPath});
  if(!proofRun.ok) return {status:'FAILED',reason:proofRun.reason,proofError:proofRun,jobId:row.id,outputPath,proofPath};
  const validation=validateHighRakePostflopProof({proof:proofRun.proof,job:row.job});
  if(!validation.ok) return {status:'FAILED',reason:'solution_validation_failed',errors:validation.errors,jobId:row.id,outputPath,proofPath};
  const proofSha256=await sha256FileStreaming(proofPath);
  let artifact;
  try{artifact=await archiveSolutionFile(outputPath,archivePath);}
  catch(error){return {status:'FAILED',reason:'solution_archive_failed',error:String(error?.message||error),jobId:row.id,outputPath,proofPath,archivePath};}
  const built=buildStreamingSidecar({row,proof:proofRun.proof,validation,configText,binarySha256,proofBinarySha256,proofSha256,artifact,startedAt,finishedAt});
  if(!built.ok) return {status:'FAILED',reason:'solution_sidecar_failed',errors:built.errors,jobId:row.id,outputPath,proofPath,archivePath};
  fs.writeFileSync(sidecarPath,JSON.stringify(built.sidecar,null,2));
  fs.rmSync(outputPath,{force:true});
  return {
    status:'VALIDATED_STRATEGY_ORACLE',jobId:row.id,outputPath,archivePath,proofPath,sidecarPath,binarySha256,
    measuredConvergencePct:built.sidecar.convergence.measuredConvergencePct,
    measuredExploitabilityPct:built.sidecar.convergence.measuredExploitabilityPct,
    iterations:built.sidecar.convergence.iterations,
    outputBytes:artifact.outputBytes,archiveBytes:artifact.archiveBytes,
    compressionRatio:artifact.outputBytes>0?artifact.archiveBytes/artifact.outputBytes:null,
    certifiedStudy:false,evAlternativeOracleReady:false,
  };
}

async function validateArchivedResume({row,archivePath,proofPath,sidecarPath,configText,binarySha256,proofBinarySha256}={}){
  try{
    const sidecar=JSON.parse(fs.readFileSync(sidecarPath,'utf8'));
    const proof=JSON.parse(fs.readFileSync(proofPath,'utf8'));
    const validation=validateHighRakePostflopProof({proof,job:row.job});
    if(!validation.ok) return {ok:false,errors:validation.errors};
    const errors=[];
    if(sidecar.version!==HIGHRake_SIDECAR_VERSION) errors.push('sidecar_version_mismatch');
    if(sidecar.status!=='VALIDATED_STRATEGY_ORACLE'||sidecar.strategyOracleReady!==true||sidecar.certifiedStudy!==false||sidecar.evAlternativeOracleReady!==false) errors.push('sidecar_authority_invalid');
    if(sidecar.jobId!==row.id||sidecar.providerFingerprint!==row.job.providerFingerprint) errors.push('sidecar_job_mismatch');
    if(sidecar.configSha256!==row.job.configSha256||row.job.configSha256!==sha256(configText)) errors.push('sidecar_config_mismatch');
    if(sidecar.solverBinarySha256!==binarySha256) errors.push('sidecar_solver_binary_mismatch');
    if(sidecar.solutionProofBinarySha256!==proofBinarySha256) errors.push('sidecar_proof_binary_mismatch');
    const proofSha256=await sha256FileStreaming(proofPath);
    if(sidecar.proofSha256!==proofSha256) errors.push('sidecar_proof_sha_mismatch');
    const archiveSha256=await sha256FileStreaming(archivePath);
    if(sidecar.archiveSha256!==archiveSha256) errors.push('sidecar_archive_sha_mismatch');
    const decodedSha256=await sha256GzipContent(archivePath);
    if(sidecar.outputSha256!==decodedSha256) errors.push('sidecar_decoded_sha_mismatch');
    if(Number(sidecar.archiveBytes)!==fs.statSync(archivePath).size) errors.push('sidecar_archive_size_mismatch');
    return {ok:errors.length===0,errors,sidecar,validation};
  }catch(error){return {ok:false,errors:[`resume_exception:${String(error?.message||error)}`]};}
}

export async function executeHighRakeJob({manifestDir,row,solverPath,proofPath:solutionProofPath,dryRun=false,resume=false}={}){
  const binary=path.resolve(String(solverPath||''));
  const proofBinary=path.resolve(String(solutionProofPath||''));
  const configPath=resolveCampaignPath(manifestDir,row.configFile);
  const outputPath=resolveCampaignPath(manifestDir,row.outputFile);
  const archivePath=`${outputPath}.gz`;
  const proofPath=`${outputPath}.proof.json`;
  const sidecarPath=`${outputPath}.meta.json`;
  const logBase=resolveCampaignPath(manifestDir,`logs/${row.split}/${row.id}`);
  if(!fs.existsSync(binary)) return {status:'BLOCKED',reason:'solver_binary_missing',jobId:row.id};
  if(!fs.statSync(binary).isFile()) return {status:'BLOCKED',reason:'solver_binary_not_file',jobId:row.id};
  if(!dryRun&&(!fs.existsSync(proofBinary)||!fs.statSync(proofBinary).isFile())) return {status:'BLOCKED',reason:'solution_proof_binary_missing',jobId:row.id};
  if(!fs.existsSync(configPath)) return {status:'BLOCKED',reason:'config_file_missing',jobId:row.id};
  const configText=fs.readFileSync(configPath,'utf8');
  const binarySha256=sha256(fs.readFileSync(binary));
  const proofBinarySha256=!dryRun?sha256(fs.readFileSync(proofBinary)):null;
  if(row.job.configSha256!==sha256(configText)) return {status:'BLOCKED',reason:'config_sha256_mismatch',jobId:row.id};

  const args=['solve','--config',configPath,'--report-every',String(row.job.convergence.reportEvery),'--threads',String(row.job.convergence.threads),'--out',outputPath];
  if(dryRun) return {status:'DRY_RUN',jobId:row.id,solverPath:binary,args,configPath,outputPath,binarySha256,configSha256:row.job.configSha256};

  if(resume&&fs.existsSync(archivePath)&&fs.existsSync(proofPath)&&fs.existsSync(sidecarPath)){
    const checked=await validateArchivedResume({row,archivePath,proofPath,sidecarPath,configText,binarySha256,proofBinarySha256});
    if(checked.ok){
      const s=checked.sidecar;
      return {status:'RESUMED_VALIDATED_STRATEGY_ORACLE',jobId:row.id,outputPath,archivePath,proofPath,sidecarPath,binarySha256,measuredConvergencePct:s.convergence.measuredConvergencePct,measuredExploitabilityPct:s.convergence.measuredExploitabilityPct,iterations:s.convergence.iterations,outputBytes:s.outputBytes,archiveBytes:s.archiveBytes,compressionRatio:s.outputBytes>0?s.archiveBytes/s.outputBytes:null,certifiedStudy:false,evAlternativeOracleReady:false};
    }
  }

  // Recover a solver-complete raw artifact after a worker crash instead of paying for
  // the solve again. If validation fails, fail closed and leave the raw evidence intact.
  if(resume&&fs.existsSync(outputPath)){
    const recovered=await validateAndArchiveExisting({manifestDir,row,outputPath,sidecarPath,proofPath,archivePath,configText,binarySha256,proofBinary,proofBinarySha256,startedAt:'recovered-existing',finishedAt:new Date().toISOString()});
    if(recovered.status==='VALIDATED_STRATEGY_ORACLE') return {...recovered,status:'RESUMED_VALIDATED_STRATEGY_ORACLE'};
    return recovered;
  }

  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.mkdirSync(path.dirname(logBase),{recursive:true});
  for(const stale of [outputPath,archivePath,proofPath,sidecarPath]) if(fs.existsSync(stale)) fs.rmSync(stale,{force:true});
  const stdoutPath=`${logBase}.stdout.log`,stderrPath=`${logBase}.stderr.log`;
  const stdout=fs.createWriteStream(stdoutPath,{flags:'w'}),stderr=fs.createWriteStream(stderrPath,{flags:'w'});
  const startedAt=new Date().toISOString();
  const child=spawn(binary,args,{cwd:path.dirname(binary),stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(stdout);child.stderr.pipe(stderr);
  const result=await wait(child);stdout.end();stderr.end();
  const finishedAt=new Date().toISOString();
  if(result.code!==0) return {status:'FAILED',reason:'solver_exit_nonzero',exitCode:result.code,signal:result.signal,jobId:row.id,stdoutPath,stderrPath};
  if(!fs.existsSync(outputPath)) return {status:'FAILED',reason:'solver_output_missing',jobId:row.id,stdoutPath,stderrPath};
  const finalized=await validateAndArchiveExisting({manifestDir,row,outputPath,sidecarPath,proofPath,archivePath,configText,binarySha256,proofBinary,proofBinarySha256,startedAt,finishedAt});
  return {...finalized,stdoutPath,stderrPath};
}
