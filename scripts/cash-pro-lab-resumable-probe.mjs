import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateHighRakeManifest } from './lib/cash-pro-lab-highrake-runner-v2.mjs';
import { assessProbeCurve, parseNashConvCheckpoint } from '../src/cash-pro-lab/probe-convergence-guard.js';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=path.join(repoRoot,'.cash-pro-lab','local-worker');
const runDir=path.join(workspace,'resumable-production-root');
const checkpoint=path.join(runDir,'solver-state.bin');
const checkpointTmp=`${checkpoint}.tmp`;
const progressPath=path.join(runDir,'curve.jsonl');
const summaryPath=path.join(runDir,'summary.json');
const solutionPath=path.join(runDir,'qualified-solution.json');
const verificationPath=path.join(runDir,'saved-profile-nashconv.json');
const proofPath=path.join(runDir,'solution-proof.json');
const maxIterations=Number(process.argv.includes('--iterations')?process.argv[process.argv.indexOf('--iterations')+1]:2500);
const fresh=process.argv.includes('--fresh');
const GiB=1024**3;

function run(cmd,args,{capture=false,cwd=repoRoot,allowFailure=false}={}){
  const r=spawnSync(cmd,args,{cwd,stdio:capture?['ignore','pipe','pipe']:'inherit',encoding:capture?'utf8':undefined,shell:false});
  if(r.error&&!allowFailure) throw r.error;
  if((r.status??1)!==0&&!allowFailure) throw new Error(`command_failed:${cmd}:${r.status}${capture?`:${String(r.stderr||'').trim()}`:''}`);
  return r;
}
function jsonRead(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function jsonWrite(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2));}
function sha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function freeDiskGB(target){const s=fs.statfsSync(target);return Number(s.bavail)*Number(s.bsize)/GiB;}
function loadCurve(){
  if(!fs.existsSync(progressPath)) return [];
  const byIter=new Map();
  for(const line of fs.readFileSync(progressPath,'utf8').split(/\r?\n/)){
    if(!line.trim()) continue;
    try{const r=JSON.parse(line);if(Number.isInteger(r.iterations)) byIter.set(r.iterations,{iterations:r.iterations,chips:Number(r.chips),pct:Number(r.pct)});}catch{}
  }
  return [...byIter.values()].sort((a,b)=>a.iterations-b.iterations);
}

if(!Number.isInteger(maxIterations)||maxIterations<100) throw new Error(`invalid_iterations:${maxIterations}`);
if(fresh) fs.rmSync(runDir,{recursive:true,force:true});
fs.mkdirSync(runDir,{recursive:true});
fs.rmSync(checkpointTmp,{force:true});
if(freeDiskGB(workspace)<120) throw new Error(`resumable_probe_disk_guard:${freeDiskGB(workspace).toFixed(1)}GB_free_requires_120GB`);

const toolchain=jsonRead(path.join(workspace,'toolchain.json'));
if(toolchain?.version!=='cash-pro-lab-local-toolchain-v3') throw new Error('resumable_probe_requires_toolchain_v3_run_prepare');
for(const [name,entry] of Object.entries({solver:toolchain.solver,solutionProof:toolchain.solutionProof,solutionNashconv:toolchain.solutionNashconv})){
  if(!entry?.path||!fs.existsSync(entry.path)) throw new Error(`${name}_binary_missing`);
  if(sha256(entry.path)!==entry.sha256) throw new Error(`${name}_sha256_mismatch`);
}

const threads=Math.min(8,os.cpus().length);
const materialized=path.join(runDir,'materialized');
run(process.execPath,[path.join(repoRoot,'scripts','cash-pro-lab-materialize-highrake-campaign.mjs'),'--out',materialized,'--threads',String(threads),'--split','train','--max','1']);
const manifestPath=path.join(materialized,'manifest.json');
const manifest=jsonRead(manifestPath);
const checked=validateHighRakeManifest(manifest||{});
if(!checked.ok) throw new Error(`resumable_probe_manifest_invalid:${checked.errors.join(',')}`);
const row=manifest.jobs?.[0];
if(!row) throw new Error('resumable_probe_job_missing');
const configPath=path.join(materialized,row.configFile);
const targetPct=Number(row.job?.convergence?.targetExploitabilityPct);
if(!Number.isFinite(targetPct)||targetPct<=0) throw new Error('resumable_probe_target_invalid');

const oldSummary=jsonRead(summaryPath);
if(oldSummary?.curveStatus==='DIVERGED'&&!fresh) throw new Error('resumable_probe_previous_divergence_requires_review_or_--fresh');

function verifyExistingSolution(){
  if(!fs.existsSync(solutionPath)) return null;
  run(toolchain.solutionProof.path,[solutionPath,proofPath],{capture:true});
  const proof=jsonRead(proofPath);
  if(proof?.structural_ok!==true) throw new Error('saved_solution_structure_proof_failed');
  run(toolchain.solutionNashconv.path,[solutionPath,verificationPath,'0.0002'],{capture:true});
  const verification=jsonRead(verificationPath);
  if(verification?.verified!==true) throw new Error('saved_solution_independent_nashconv_failed');
  return {proof,verification};
}

const existing=verifyExistingSolution();
if(existing&&Number(existing.verification.nashconv_pct_of_pot)<=targetPct+1e-6){
  const ready={version:'cash-pro-lab-resumable-probe-v2',readyForPilot:true,rowId:row.id,targetPct,curve:loadCurve(),curveStatus:'TARGET_STABLE',checkpoint,solutionPath,verificationPath,proofPath,verification:existing.verification,artifactWritten:true,resumable:true,finishedAt:new Date().toISOString()};
  jsonWrite(summaryPath,ready);
  console.log(JSON.stringify({ok:true,mode:'resumable-probe',probe:ready},null,2));
  process.exit(0);
}

let curve=loadCurve();
const initialAssessment=assessProbeCurve(curve,{targetPct});
if(initialAssessment.status==='DIVERGED') throw new Error('resumable_probe_existing_curve_diverged');

const solverArgs=['solve','--config',configPath,'--report-every','100','--threads',String(threads),'--max-iterations',String(maxIterations),'--target-exploitability',String(targetPct),'--target-confirmations','3','--checkpoint',checkpoint];
if(fs.existsSync(checkpoint)) solverArgs.push('--resume',checkpoint);
console.log(JSON.stringify({mode:'resumable-probe',rowId:row.id,threads,maxIterations,targetPct,targetConfirmations:3,resuming:fs.existsSync(checkpoint),checkpoint,progressPath,noWallClockKill:true},null,2));

const child=spawn(toolchain.solver.path,solverArgs,{cwd:path.dirname(toolchain.solver.path),stdio:['ignore','pipe','pipe']});
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
let lineBuf='',stderrTail='',stopEvent=null;
const forward=sig=>{try{child.kill(sig);}catch{}};
process.once('SIGTERM',()=>forward('SIGTERM'));
process.once('SIGINT',()=>forward('SIGINT'));

function appendCheckpoint(cp,assessment){
  const rowOut={at:new Date().toISOString(),...cp,status:assessment.status,reason:assessment.reason};
  fs.appendFileSync(progressPath,JSON.stringify(rowOut)+'\n');
  console.log(`[resumable-probe] iter=${cp.iterations} nashconv=${cp.pct.toFixed(4)}% best=${assessment.best?.pct?.toFixed?.(4)??'n/a'} status=${assessment.status} checkpoint=safe`);
}
function consumeLine(line){
  if(line.startsWith('resumed checkpoint')||line.startsWith('resume iter')) console.log(`[solver] ${line}`);
  const cp=parseNashConvCheckpoint(line);
  if(!cp) return;
  const prior=curve.findIndex(x=>x.iterations===cp.iterations);
  if(prior>=0) curve[prior]=cp; else curve.push(cp);
  curve.sort((a,b)=>a.iterations-b.iterations);
  const assessment=assessProbeCurve(curve,{targetPct});
  appendCheckpoint(cp,assessment);
  if(!stopEvent&&assessment.status==='DIVERGED'){
    stopEvent={at:new Date().toISOString(),...assessment};
    console.error(`[resumable-probe] ABORT ${assessment.reason}; latest exact checkpoint is already on disk at iter ${cp.iterations}`);
    child.kill('SIGTERM');
  }
}
child.stdout.on('data',chunk=>{lineBuf+=chunk;const lines=lineBuf.split(/\r?\n/);lineBuf=lines.pop()??'';for(const line of lines) consumeLine(line);});
child.stderr.on('data',chunk=>{stderrTail=(stderrTail+chunk).slice(-256*1024);});
const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
if(lineBuf) consumeLine(lineBuf);

const assessment=assessProbeCurve(curve,{targetPct});
const diverged=stopEvent?.status==='DIVERGED'||assessment.status==='DIVERGED';
const targetStable=assessment.status==='TARGET_STABLE';
let exported=false,verification=null,proof=null;
if(targetStable&&!diverged&&fs.existsSync(checkpoint)){
  const last=curve.at(-1);
  const exportRun=run(toolchain.solver.path,[
    'solve','--config',configPath,'--report-every','100','--threads',String(threads),
    '--max-iterations',String(last.iterations),'--target-exploitability',String(targetPct),
    '--target-confirmations','1','--resume',checkpoint,'--out',solutionPath,
  ],{capture:true});
  if((exportRun.status??0)!==0||!fs.existsSync(solutionPath)) throw new Error('qualified_checkpoint_export_failed');
  const verified=verifyExistingSolution();
  verification=verified.verification;proof=verified.proof;exported=true;
}
const independentlyQualified=exported&&verification?.verified===true&&Number(verification.nashconv_pct_of_pot)<=targetPct+1e-6;
const probe={
  version:'cash-pro-lab-resumable-probe-v2',startedFromCheckpoint:solverArgs.includes('--resume'),finishedAt:new Date().toISOString(),
  rowId:row.id,threads,maxIterations,targetPct,targetConfirmations:3,curve,bestReport:assessment.best,lastReport:assessment.last,
  curveStatus:diverged?'DIVERGED':targetStable?'TARGET_STABLE':assessment.status,stopReason:stopEvent?.reason??(targetStable?'nashconv_target_stable':exit.code===0?'iteration_ceiling_reached':'solver_interrupted'),
  checkpoint,checkpointBytes:fs.existsSync(checkpoint)?fs.statSync(checkpoint).size:0,checkpointResumable:fs.existsSync(checkpoint),
  solutionPath:exported?solutionPath:null,artifactWritten:exported,independentVerification:verification,structuralProof:proof,
  readyForPilot:independentlyQualified&&!diverged,resumable:true,noWallClockKill:true,
  solverSha256:toolchain.solver.sha256,enginePatchId:toolchain.localPatch.id,exit:{...exit,stderr:stderrTail.trim().slice(-4000)},
};
jsonWrite(summaryPath,probe);
const state=jsonRead(path.join(workspace,'worker-state.json'),{version:'cash-pro-lab-local-worker-state-v2',campaigns:{}});state.probe=probe;state.updatedAt=new Date().toISOString();jsonWrite(path.join(workspace,'worker-state.json'),state);
console.log(JSON.stringify({ok:probe.readyForPilot,mode:'resumable-probe',probe},null,2));
if(!probe.readyForPilot) process.exitCode=diverged?3:2;
