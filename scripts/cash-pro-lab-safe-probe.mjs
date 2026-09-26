import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateHighRakeManifest } from './lib/cash-pro-lab-highrake-runner.mjs';
import { HIGHRake_POSTFLOP_ENGINE } from '../src/cash-pro-lab/highrake-postflop-job-builder.js';
import { evaluateLocalSolveWorkerHardware } from '../src/cash-pro-lab/local-solve-worker-profile.js';
import { assessProbeCurve, parseNashConvCheckpoint } from '../src/cash-pro-lab/probe-convergence-guard.js';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=path.join(repoRoot,'.cash-pro-lab','local-worker');
const GiB=1024**3;

function arg(name,fallback=null){const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]!=null?process.argv[i+1]:fallback;}
function has(name){return process.argv.includes(name);}
function intArg(name,fallback){const raw=arg(name,null);if(raw==null)return fallback;const n=Number(raw);if(!Number.isInteger(n)||n<1)throw new Error(`invalid ${name} ${raw}`);return n;}
function now(){return new Date().toISOString();}
function jsonRead(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function jsonWrite(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2));}
function sha256File(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function freeDiskGB(target){const s=fs.statfsSync(target);return Number(s.bavail)*Number(s.bsize)/GiB;}
function processRssBytes(pid){
  if(process.platform!=='linux') return null;
  try{const text=fs.readFileSync(`/proc/${pid}/status`,'utf8');const m=text.match(/^VmRSS:\s+(\d+)\s+kB$/m);return m?Number(m[1])*1024:null;}catch{return null;}
}
function run(cmd,args,{cwd=repoRoot,capture=false}={}){
  const r=spawnSync(cmd,args,{cwd,stdio:capture?['ignore','pipe','pipe']:'inherit',encoding:capture?'utf8':undefined,shell:false});
  if(r.error) throw r.error;
  if((r.status??1)!==0) throw new Error(`command_failed:${cmd}:${r.status}${capture?`:${String(r.stderr||'').trim()}`:''}`);
  return r;
}
function loadState(){return jsonRead(path.join(workspace,'worker-state.json'),{version:'cash-pro-lab-local-worker-state-v2',createdAt:now(),probe:null,pilot:null,campaigns:{}});}
function saveState(state){state.updatedAt=now();jsonWrite(path.join(workspace,'worker-state.json'),state);}

fs.mkdirSync(workspace,{recursive:true});
const maxIterations=intArg('--iterations',300);
const reportEvery=intArg('--report-every',50);
const allowLong=has('--allow-long');
if(maxIterations>600&&!allowLong){
  throw new Error(`safe_probe_iteration_guard:${maxIterations}>600:use_--allow-long_only_after_reviewing_a_short_curve`);
}
if(reportEvery>100) throw new Error('safe_probe_report_every_guard:max_100');

const preflight=evaluateLocalSolveWorkerHardware({
  logicalCpus:os.cpus().length,
  totalMemGB:os.totalmem()/GiB,
  freeMemGB:os.freemem()/GiB,
  freeDiskGB:freeDiskGB(workspace),
});
if(!preflight?.pilot?.allowed) throw new Error(`safe_probe_blocked:${(preflight?.pilot?.reasons||[]).join(',')}`);

const toolchain=jsonRead(path.join(workspace,'toolchain.json'));
if(toolchain?.version!=='cash-pro-lab-local-toolchain-v2') throw new Error('safe_probe_requires_prepared_toolchain_v2');
if(toolchain?.engine?.sourceCommit!==HIGHRake_POSTFLOP_ENGINE.sourceCommit) throw new Error('safe_probe_toolchain_source_mismatch');
if(toolchain?.localPatch?.id!==HIGHRake_POSTFLOP_ENGINE.localPatch.id) throw new Error('safe_probe_toolchain_patch_mismatch');
const solverPath=toolchain?.solver?.path;
if(!solverPath||!fs.existsSync(solverPath)) throw new Error('safe_probe_solver_missing');
if(sha256File(solverPath)!==toolchain.solver.sha256) throw new Error('safe_probe_solver_sha256_mismatch');

const threads=preflight?.recommendation?.campaignThreads??1;
const outDir=path.join(workspace,`probe-production-quality-t${threads}`);
run(process.execPath,[
  path.join(repoRoot,'scripts','cash-pro-lab-materialize-highrake-campaign.mjs'),
  '--out',outDir,'--threads',String(threads),'--split','train','--max','1',
]);
const manifestPath=path.join(outDir,'manifest.json');
const manifest=jsonRead(manifestPath);
const checked=validateHighRakeManifest(manifest||{});
if(!checked.ok) throw new Error(`safe_probe_manifest_invalid:${checked.errors.join(',')}`);
const row=manifest.jobs?.[0];
if(!row) throw new Error('safe_probe_job_missing');
const configPath=path.join(outDir,row.configFile);
const targetPct=Number(row.job?.convergence?.targetExploitabilityPct);
if(!Number.isFinite(targetPct)||targetPct<=0) throw new Error('safe_probe_target_invalid');

const progressPath=path.join(workspace,'probe-safe-progress.jsonl');
const summaryPath=path.join(workspace,'probe-safe-summary.json');
fs.writeFileSync(progressPath,'');
const startedAt=now();
const startedMs=Date.now();
const solverArgs=['solve','--config',configPath,'--report-every',String(reportEvery),'--threads',String(threads),'--max-iterations',String(maxIterations)];
console.log(JSON.stringify({mode:'safe-probe',rowId:row.id,threads,maxIterations,reportEvery,targetPct,progressPath,artifactWritten:false},null,2));

const child=spawn(solverPath,solverArgs,{cwd:path.dirname(solverPath),stdio:['ignore','pipe','pipe']});
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
let stdoutTail='',stderrTail='',lineBuf='',peakRssBytes=0,tree=null,strategyStorageBytes=null;
let curve=[];
let guardStop=null;

function sampleRss(){const rss=processRssBytes(child.pid);if(Number.isFinite(rss))peakRssBytes=Math.max(peakRssBytes,rss);}
function appendCheckpoint(cp,assessment){
  const rowOut={at:now(),...cp,status:assessment.status,reason:assessment.reason};
  fs.appendFileSync(progressPath,JSON.stringify(rowOut)+'\n');
  console.log(`[safe-probe] iter=${cp.iterations} nashconv=${cp.pct.toFixed(4)}% best=${assessment.best?.pct?.toFixed?.(4)??'n/a'} status=${assessment.status}`);
}
function consumeLine(line){
  const treeMatch=line.match(/tree:\s+(\d+) decision,\s+(\d+) chance,\s+(\d+) fold,\s+(\d+) showdown terminals \((\d+) nodes total\)/);
  if(treeMatch) tree={decision:Number(treeMatch[1]),chance:Number(treeMatch[2]),fold:Number(treeMatch[3]),showdown:Number(treeMatch[4]),total:Number(treeMatch[5])};
  const storageMatch=line.match(/strategy storage:\s+\w+,\s+(\d+) bytes/);
  if(storageMatch) strategyStorageBytes=Number(storageMatch[1]);
  const cp=parseNashConvCheckpoint(line);
  if(!cp) return;
  curve.push(cp);
  const assessment=assessProbeCurve(curve,{targetPct});
  appendCheckpoint(cp,assessment);
  if(assessment.status==='DIVERGED'&&!guardStop){
    guardStop={at:now(),...assessment};
    console.error(`[safe-probe] ABORT ${assessment.reason}: best=${assessment.best?.pct}% last=${assessment.last?.pct}%`);
    child.kill('SIGTERM');
  }
}

child.stdout.on('data',chunk=>{
  stdoutTail=(stdoutTail+chunk).slice(-1024*1024);
  lineBuf+=chunk;
  const lines=lineBuf.split(/\r?\n/);lineBuf=lines.pop()??'';
  for(const line of lines) consumeLine(line);
});
child.stderr.on('data',chunk=>{stderrTail=(stderrTail+chunk).slice(-256*1024);});

sampleRss();
const timer=setInterval(sampleRss,250);timer.unref?.();
const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
clearInterval(timer);sampleRss();
if(lineBuf) consumeLine(lineBuf);

const assessment=assessProbeCurve(curve,{targetPct});
const totalMemBytes=Number(preflight.hardware.totalMemGB)*GiB;
const estimatedSavePeakBytes=peakRssBytes+(Number(strategyStorageBytes)||0);
const memorySafe=peakRssBytes>0&&Number(strategyStorageBytes)>0&&estimatedSavePeakBytes<=totalMemBytes*0.85;
const cleanExit=exit.code===0&&exit.signal==null;
const targetReached=curve.some(r=>r.pct<=targetPct);
const readyForPilot=cleanExit&&targetReached&&assessment.status!=='DIVERGED'&&memorySafe&&tree?.total>0;
const passed=guardStop==null&&curve.length>0&&memorySafe&&tree?.total>0&&Number(strategyStorageBytes)>0;
const bestReport=curve.length?curve.reduce((a,b)=>b.pct<a.pct?b:a,curve[0]):null;
const lastReport=curve.at(-1)??null;

const probe={
  version:'cash-pro-lab-production-safe-probe-v1',startedAt,finishedAt:now(),passed,readyForPilot,
  rowId:row.id,threads,iterationCeiling:maxIterations,reportEvery,targetConvergencePct:targetPct,
  curve,bestReport,lastReport,curveStatus:guardStop?'DIVERGED':assessment.status,stopReason:guardStop?.reason??(targetReached?'nashconv_target_reached':'iteration_ceiling_reached'),
  measured:{tree,strategyStorageBytes,report:lastReport,wallSeconds:Number(((Date.now()-startedMs)/1000).toFixed(3))},
  peakRssGB:Number((peakRssBytes/GiB).toFixed(2)),estimatedSavePeakGB:Number((estimatedSavePeakBytes/GiB).toFixed(2)),memorySafe,
  solverSha256:toolchain.solver.sha256,solutionProofSha256:toolchain?.solutionProof?.sha256??null,enginePatchId:toolchain.localPatch.id,
  manifestPath,progressPath,artifactWritten:false,
  exit:{...exit,stderr:stderrTail.trim().slice(-4000)},
  guardStop,
  note:readyForPilot?'Target reached on a measured production-root checkpoint with bounded memory and no artifact write.':'Pilot remains blocked. Review the complete checkpoint curve before increasing the iteration ceiling.',
};
const state=loadState();state.probe=probe;saveState(state);jsonWrite(summaryPath,{ok:passed&&readyForPilot,mode:'safe-probe',probe});
console.log(JSON.stringify({ok:passed&&readyForPilot,mode:'safe-probe',probe},null,2));
if(!readyForPilot) process.exitCode=2;
