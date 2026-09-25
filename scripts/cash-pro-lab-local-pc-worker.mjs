import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeHighRakeJob, validateHighRakeManifest } from './lib/cash-pro-lab-highrake-runner.mjs';
import { HIGHRake_POSTFLOP_ENGINE } from '../src/cash-pro-lab/highrake-postflop-job-builder.js';
import { evaluateLocalSolveWorkerHardware, unlockCampaignAfterPilot } from '../src/cash-pro-lab/local-solve-worker-profile.js';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspaceDefault=path.join(repoRoot,'.cash-pro-lab','local-worker');
const GiB=1024**3;

function arg(name,fallback=null){const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]!=null?process.argv[i+1]:fallback;}
function intArg(name,fallback=null){const raw=arg(name,null);if(raw==null)return fallback;const n=Number(raw);if(!Number.isInteger(n)||n<1)throw new Error(`invalid ${name} ${raw}`);return n;}
function now(){return new Date().toISOString();}
function sha256File(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function jsonWrite(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2));}
function jsonRead(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function run(cmd,args,{cwd=repoRoot,allowFailure=false,capture=false}={}){
  const r=spawnSync(cmd,args,{cwd,stdio:capture?['ignore','pipe','pipe']:'inherit',encoding:capture?'utf8':undefined,shell:false});
  if(r.error&&!allowFailure) throw r.error;
  if((r.status??1)!==0&&!allowFailure) throw new Error(`command_failed:${cmd}:${r.status}${capture?`:${String(r.stderr||'').trim()}`:''}`);
  return r;
}
function commandExists(cmd,args=['--version']){const r=run(cmd,args,{allowFailure:true,capture:true});return !r.error&&r.status===0;}
function freeDiskGB(target){
  try{const s=fs.statfsSync(target);return Number(s.bavail)*Number(s.bsize)/GiB;}catch{return NaN;}
}
function hardwareReport(workspace){
  fs.mkdirSync(workspace,{recursive:true});
  const report=evaluateLocalSolveWorkerHardware({
    logicalCpus:os.cpus().length,
    totalMemGB:os.totalmem()/GiB,
    freeMemGB:os.freemem()/GiB,
    freeDiskGB:freeDiskGB(workspace),
  });
  return {
    version:'cash-pro-lab-local-pc-preflight-v2',
    generatedAt:now(),
    platform:process.platform,
    arch:process.arch,
    node:process.version,
    commands:{git:commandExists('git'),cargo:commandExists('cargo')},
    ...report,
  };
}
function solverBinaryPath(sourceDir){return path.join(sourceDir,'target','release',process.platform==='win32'?'solver.exe':'solver');}
function actionEvBinaryPath(){return path.join(repoRoot,'tools','highrake-action-ev','target','release',process.platform==='win32'?'cash-pro-lab-action-ev.exe':'cash-pro-lab-action-ev');}
function solutionProofBinaryPath(){return path.join(repoRoot,'tools','highrake-action-ev','target','release',process.platform==='win32'?'solution-proof.exe':'solution-proof');}
function patchPinnedSource(sourceDir){
  const patch=HIGHRake_POSTFLOP_ENGINE?.localPatch;
  if(!patch?.id||!patch?.file) throw new Error('solver_local_patch_contract_missing');
  const patchPath=path.join(repoRoot,patch.file);
  if(!fs.existsSync(patchPath)) throw new Error(`solver_local_patch_file_missing:${patchPath}`);
  run('git',['-C',sourceDir,'reset','--hard',HIGHRake_POSTFLOP_ENGINE.sourceCommit]);
  run('git',['-C',sourceDir,'apply','--check',patchPath]);
  run('git',['-C',sourceDir,'apply',patchPath]);
  return {
    id:patch.id,
    file:patch.file,
    patchSha256:sha256File(patchPath),
    nlheSha256:sha256File(path.join(sourceDir,'engine','src','nlhe.rs')),
    solveCliSha256:sha256File(path.join(sourceDir,'cli','src','solve.rs')),
  };
}
function rakedSmokeConfig(){return `board = "Ks 7d 2c 8h 3d"
oop_range = "KK,A4s,A5s"
ip_range = "TT,JJ"
effective_stack = 10.0
starting_pot = 10.0
allin_threshold = 1.5
raise_cap = 0
target_exploitability = 100.0
max_iterations = 1
alpha = 1.5
beta = 0.0
gamma = 2.0
turn_chance_sampling = false
regret_floor = false

[rake]
percent = 5.0
cap = 2.5

[sizings.oop.river]
bet = { percents = [100.0] }

[sizings.ip.river]
bet = { percents = [100.0] }
`}
function runRakedToolchainSmoke({workspace,solver,solutionProof}){
  const dir=path.join(workspace,'toolchain-smoke-raked-nashconv-v1');
  fs.mkdirSync(dir,{recursive:true});
  const config=path.join(dir,'spot.toml'),output=path.join(dir,'solution.json'),proof=path.join(dir,'proof.json');
  fs.writeFileSync(config,rakedSmokeConfig());
  for(const f of [output,proof]) if(fs.existsSync(f)) fs.rmSync(f,{force:true});
  const solved=run(solver,['solve','--config',config,'--report-every','1','--threads','1','--out',output],{capture:true});
  const stdout=String(solved.stdout||'');
  const match=stdout.match(/iter\s+1\s+NashConv\s+([-+0-9.eE]+)\s+chips\s+([-+0-9.eE]+)% of pot/);
  if(!match) throw new Error(`raked_smoke_missing_nashconv:${stdout.slice(-2000)}`);
  const chips=Number(match[1]),pct=Number(match[2]);
  if(!Number.isFinite(chips)||chips<0||!Number.isFinite(pct)||pct<0) throw new Error(`raked_smoke_invalid_nashconv:${chips}:${pct}`);
  run(solutionProof,[output,proof],{capture:true});
  const parsed=jsonRead(proof);
  if(parsed?.structural_ok!==true||parsed?.version!=='cash-pro-lab-solution-stream-proof-v1') throw new Error('raked_smoke_solution_proof_failed');
  const gain=parsed?.meta?.gain;
  if(!Array.isArray(gain)||gain.length!==2||gain.some(v=>!Number.isFinite(Number(v))||Number(v)<-1e-7)) throw new Error('raked_smoke_gain_invalid');
  const result={version:'cash-pro-lab-raked-toolchain-smoke-v1',ok:true,chips,pct,iterations:parsed.meta.iterations,nodeCount:parsed.node_count,decisionNodes:parsed.decision_nodes};
  jsonWrite(path.join(dir,'smoke-result.json'),result);
  fs.rmSync(output,{force:true});
  fs.rmSync(proof,{force:true});
  return result;
}
function buildPinnedToolchain(workspace){
  if(!commandExists('git')) throw new Error('git_missing');
  if(!commandExists('cargo')) throw new Error('cargo_missing_install_rustup_first');
  const vendorDir=path.join(workspace,'vendor');
  const sourceDir=path.join(vendorDir,'postflop');
  fs.mkdirSync(vendorDir,{recursive:true});
  if(!fs.existsSync(path.join(sourceDir,'.git'))){
    run('git',['clone','--filter=blob:none','https://github.com/ucsandman/postflop.git',sourceDir]);
  }
  const hasCommit=run('git',['-C',sourceDir,'cat-file','-e',`${HIGHRake_POSTFLOP_ENGINE.sourceCommit}^{commit}`],{allowFailure:true,capture:true}).status===0;
  if(!hasCommit) run('git',['-C',sourceDir,'fetch','origin',HIGHRake_POSTFLOP_ENGINE.sourceCommit,'--depth=1']);
  run('git',['-C',sourceDir,'checkout','--detach',HIGHRake_POSTFLOP_ENGINE.sourceCommit]);
  const head=String(run('git',['-C',sourceDir,'rev-parse','HEAD'],{capture:true}).stdout||'').trim();
  if(head!==HIGHRake_POSTFLOP_ENGINE.sourceCommit) throw new Error(`solver_source_commit_mismatch:${head}`);
  const localPatch=patchPinnedSource(sourceDir);
  run('cargo',['build','--release','--manifest-path',path.join(sourceDir,'Cargo.toml'),'--bin','solver']);
  const toolManifest=path.join(repoRoot,'tools','highrake-action-ev','Cargo.toml');
  run('cargo',['build','--release','--manifest-path',toolManifest,'--bin','cash-pro-lab-action-ev']);
  run('cargo',['build','--release','--manifest-path',toolManifest,'--bin','solution-proof']);
  const solver=solverBinaryPath(sourceDir),actionEv=actionEvBinaryPath(),solutionProof=solutionProofBinaryPath();
  if(!fs.existsSync(solver)||!fs.existsSync(actionEv)||!fs.existsSync(solutionProof)) throw new Error('toolchain_binary_missing_after_build');
  const smoke=runRakedToolchainSmoke({workspace,solver,solutionProof});
  const manifest={
    version:'cash-pro-lab-local-toolchain-v2',generatedAt:now(),
    engine:{...HIGHRake_POSTFLOP_ENGINE},localPatch,
    solver:{path:solver,sha256:sha256File(solver)},
    actionEv:{path:actionEv,sha256:sha256File(actionEv)},
    solutionProof:{path:solutionProof,sha256:sha256File(solutionProof)},
    smoke,
    platform:process.platform,arch:process.arch,
    authority:{productionStrategy:false,certifiedStudies:0},
  };
  jsonWrite(path.join(workspace,'toolchain.json'),manifest);
  return manifest;
}
function requireToolchain(workspace){
  const manifest=jsonRead(path.join(workspace,'toolchain.json'));
  if(!manifest?.solver?.path||!fs.existsSync(manifest.solver.path)) return buildPinnedToolchain(workspace);
  const errors=[];
  if(manifest?.version!=='cash-pro-lab-local-toolchain-v2') errors.push('toolchain_version_stale_run_prepare');
  if(manifest?.engine?.sourceCommit!==HIGHRake_POSTFLOP_ENGINE.sourceCommit) errors.push('toolchain_source_commit_mismatch');
  if(manifest?.engine?.localPatch?.id!==HIGHRake_POSTFLOP_ENGINE.localPatch.id||manifest?.localPatch?.id!==HIGHRake_POSTFLOP_ENGINE.localPatch.id) errors.push('toolchain_local_patch_mismatch_run_prepare');
  if(manifest?.smoke?.ok!==true) errors.push('toolchain_raked_smoke_not_passed');
  if(sha256File(manifest.solver.path)!==manifest.solver.sha256) errors.push('solver_binary_sha256_mismatch');
  if(!manifest?.actionEv?.path||!fs.existsSync(manifest.actionEv.path)||sha256File(manifest.actionEv.path)!==manifest.actionEv.sha256) errors.push('action_ev_binary_sha256_mismatch');
  if(!manifest?.solutionProof?.path||!fs.existsSync(manifest.solutionProof.path)||sha256File(manifest.solutionProof.path)!==manifest.solutionProof.sha256) errors.push('solution_proof_binary_sha256_mismatch');
  if(errors.length) throw new Error(errors.join(','));
  return manifest;
}
function materializeCampaign({workspace,threads,split=null,max=null,label='production'}){
  const outDir=path.join(workspace,`${label}-t${threads}`);
  const args=[path.join(repoRoot,'scripts','cash-pro-lab-materialize-highrake-campaign.mjs'),'--out',outDir,'--threads',String(threads)];
  if(split) args.push('--split',split);
  if(max!=null) args.push('--max',String(max));
  run(process.execPath,args,{cwd:repoRoot});
  const manifestPath=path.join(outDir,'manifest.json');
  const manifest=jsonRead(manifestPath);
  const checked=validateHighRakeManifest(manifest||{});
  if(!checked.ok) throw new Error(`materialized_manifest_invalid:${checked.errors.join(',')}`);
  return {outDir,manifestPath,manifest};
}
function statePath(workspace){return path.join(workspace,'worker-state.json');}
function loadState(workspace){return jsonRead(statePath(workspace),{version:'cash-pro-lab-local-worker-state-v2',createdAt:now(),probe:null,pilot:null,campaigns:{}});}
function saveState(workspace,state){state.updatedAt=now();jsonWrite(statePath(workspace),state);}
function wait(child){return new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});}
function processRssBytes(pid){
  if(process.platform!=='linux') return null;
  try{
    const text=fs.readFileSync(`/proc/${pid}/status`,'utf8');
    const m=text.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    return m?Number(m[1])*1024:null;
  }catch{return null;}
}
async function runMeasuredProbe({solverPath,configPath,threads,iterations}){
  const args=['solve','--config',configPath,'--report-every','100','--threads',String(threads),'--max-iterations',String(iterations)];
  const child=spawn(solverPath,args,{cwd:path.dirname(solverPath),stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',peakRssBytes=0;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{if(stdout.length<4*1024*1024) stdout+=chunk;});
  child.stderr.on('data',chunk=>{if(stderr.length<1024*1024) stderr+=chunk;});
  const sample=()=>{const rss=processRssBytes(child.pid);if(Number.isFinite(rss))peakRssBytes=Math.max(peakRssBytes,rss);};
  sample();
  const timer=setInterval(sample,250);timer.unref?.();
  const result=await wait(child);clearInterval(timer);sample();
  return {result,stdout,stderr,peakRssBytes,args};
}
function parseProbe(stdout){
  const tree=stdout.match(/tree:\s+(\d+) decision,\s+(\d+) chance,\s+(\d+) fold,\s+(\d+) showdown terminals \((\d+) nodes total\)/);
  const storage=stdout.match(/strategy storage:\s+\w+,\s+(\d+) bytes/);
  const reports=[...stdout.matchAll(/iter\s+(\d+)\s+NashConv\s+([-+0-9.eE]+)\s+chips\s+([-+0-9.eE]+)% of pot/g)];
  const last=reports.at(-1);
  const wall=[...stdout.matchAll(/wall time:\s+([-+0-9.eE]+) s/g)].at(-1);
  return {
    tree:tree?{decision:Number(tree[1]),chance:Number(tree[2]),fold:Number(tree[3]),showdown:Number(tree[4]),total:Number(tree[5])}:null,
    strategyStorageBytes:storage?Number(storage[1]):null,
    report:last?{iterations:Number(last[1]),chips:Number(last[2]),pct:Number(last[3])}:null,
    wallSeconds:wall?Number(wall[1]):null,
  };
}
async function runProbe({workspace,preflight,iterations}){
  if(!preflight?.pilot?.allowed) throw new Error(`probe_blocked:${(preflight?.pilot?.reasons||[]).join(',')}`);
  const toolchain=requireToolchain(workspace);
  const threads=preflight?.recommendation?.campaignThreads??1;
  const materialized=materializeCampaign({workspace,threads,split:'train',max:1,label:'probe-production-quality'});
  const row=materialized.manifest.jobs[0];
  if(!row) throw new Error('probe_job_missing');
  const configPath=path.join(materialized.outDir,row.configFile);
  const measured=await runMeasuredProbe({solverPath:toolchain.solver.path,configPath,threads,iterations});
  const parsed=parseProbe(measured.stdout);
  const totalMemBytes=Number(preflight.hardware.totalMemGB)*GiB;
  const estimatedSavePeakBytes=measured.peakRssBytes+(Number(parsed.strategyStorageBytes)||0);
  const memorySafe=measured.peakRssBytes>0&&estimatedSavePeakBytes<=totalMemBytes*0.85;
  const target=Number(row.job.convergence.targetExploitabilityPct);
  const metricOk=parsed.report&&Number.isFinite(parsed.report.pct)&&parsed.report.pct>=0;
  const readyForPilot=measured.result.code===0&&metricOk&&parsed.report.pct<=target+1e-6&&memorySafe;
  const passed=measured.result.code===0&&metricOk&&memorySafe&&parsed.tree?.total>0&&Number(parsed.strategyStorageBytes)>0;
  const state=loadState(workspace);
  state.probe={
    version:'cash-pro-lab-production-probe-v1',startedAt:now(),finishedAt:now(),passed,readyForPilot,
    rowId:row.id,threads,iterationCeiling:iterations,targetConvergencePct:target,
    measured:parsed,peakRssGB:Number((measured.peakRssBytes/GiB).toFixed(2)),estimatedSavePeakGB:Number((estimatedSavePeakBytes/GiB).toFixed(2)),memorySafe,
    solverSha256:toolchain.solver.sha256,solutionProofSha256:toolchain.solutionProof.sha256,enginePatchId:toolchain.localPatch.id,
    manifestPath:materialized.manifestPath,
    exit:{code:measured.result.code,signal:measured.result.signal,stderr:measured.stderr.trim().slice(-4000)},
    note:readyForPilot?'Production root reached the configured NashConv target without writing the huge solution. Full pilot may now persist exactly this root.':'No production artifact was written. Increase the probe iteration ceiling only if convergence has not yet reached target; do not run the full pilot yet.',
  };
  saveState(workspace,state);
  return state.probe;
}
async function runPilot({workspace,preflight}){
  if(!preflight?.pilot?.allowed) throw new Error(`pilot_blocked:${(preflight?.pilot?.reasons||[]).join(',')}`);
  const toolchain=requireToolchain(workspace);
  const state=loadState(workspace);
  const probe=state.probe;
  if(probe?.readyForPilot!==true) throw new Error('pilot_blocked:production_probe_not_ready');
  if(probe.solverSha256!==toolchain.solver.sha256||probe.enginePatchId!==toolchain.localPatch.id) throw new Error('pilot_blocked:probe_toolchain_mismatch');
  const threads=probe.threads;
  const materialized=materializeCampaign({workspace,threads,split:'train',max:1,label:'pilot-production-quality'});
  const row=materialized.manifest.jobs[0];
  if(!row) throw new Error('pilot_job_missing');
  if(row.id!==probe.rowId) throw new Error('pilot_blocked:probe_root_mismatch');
  const startedAt=now();
  const result=await executeHighRakeJob({manifestDir:materialized.outDir,row,solverPath:toolchain.solver.path,proofPath:toolchain.solutionProof.path,resume:true});
  const passed=['VALIDATED_STRATEGY_ORACLE','RESUMED_VALIDATED_STRATEGY_ORACLE'].includes(result.status);
  state.pilot={version:'cash-pro-lab-local-production-pilot-v2',startedAt,finishedAt:now(),passed,rowId:row.id,split:row.split,threads,result,hardware:preflight.hardware,solverSha256:toolchain.solver.sha256,solutionProofSha256:toolchain.solutionProof.sha256,enginePatchId:toolchain.localPatch.id,manifestPath:materialized.manifestPath,authority:{certifiedStudies:0,productionCampaignUnlocked:passed}};
  saveState(workspace,state);
  return state.pilot;
}
function splitRank(s){return s==='train'?0:s==='dev'?1:2;}
function diskProjection({pilotResult,jobs,freeDiskGB}){
  const archiveBytes=Number(pilotResult?.archiveBytes),outputBytes=Number(pilotResult?.outputBytes);
  if(!(archiveBytes>0)||!(outputBytes>0)) return {ok:false,reason:'pilot_artifact_sizes_missing'};
  const archiveSafety=1.5;
  const tempSafety=1.25;
  const projectedArchiveBytes=archiveBytes*jobs*archiveSafety;
  const oneRawWorkingBytes=outputBytes*tempSafety;
  const requiredBytes=projectedArchiveBytes+oneRawWorkingBytes;
  const freeBytes=Number(freeDiskGB)*GiB;
  return {
    ok:Number.isFinite(freeBytes)&&requiredBytes<=freeBytes*0.9,
    archiveSafety,tempSafety,jobs,
    pilotArchiveGB:Number((archiveBytes/GiB).toFixed(2)),pilotRawGB:Number((outputBytes/GiB).toFixed(2)),
    projectedArchiveGB:Number((projectedArchiveBytes/GiB).toFixed(1)),oneRawWorkingGB:Number((oneRawWorkingBytes/GiB).toFixed(1)),requiredGB:Number((requiredBytes/GiB).toFixed(1)),freeDiskGB:Number(freeDiskGB),
  };
}
async function runCampaign({workspace,preflight,threads,maxJobs=null,onlySplit=null}){
  const state=loadState(workspace);
  const unlocked=unlockCampaignAfterPilot(preflight,{pilotPassed:state?.pilot?.passed===true});
  if(!unlocked.allowed) throw new Error(`campaign_blocked:${unlocked.reasons.join(',')}`);
  const toolchain=requireToolchain(workspace);
  if(threads!==state?.pilot?.threads) throw new Error(`campaign_blocked:threads_${threads}_not_probed_and_piloted_${state?.pilot?.threads}`);
  const materialized=materializeCampaign({workspace,threads,label:'production-campaign'});
  let jobs=[...materialized.manifest.jobs].sort((a,b)=>splitRank(a.split)-splitRank(b.split)||a.id.localeCompare(b.id));
  if(onlySplit){if(!['train','dev','holdout'].includes(onlySplit))throw new Error(`invalid_split:${onlySplit}`);jobs=jobs.filter(j=>j.split===onlySplit);}
  if(maxJobs!=null) jobs=jobs.slice(0,maxJobs);
  const projection=diskProjection({pilotResult:state.pilot.result,jobs:jobs.length,freeDiskGB:freeDiskGB(workspace)});
  if(!projection.ok) throw new Error(`campaign_blocked:disk_projection:${JSON.stringify(projection)}`);
  const campaignKey=`${materialized.manifest.campaignId}:threads=${threads}`;
  const campaign=state.campaigns[campaignKey]??{version:'cash-pro-lab-local-production-campaign-v2',startedAt:now(),threads,manifestPath:materialized.manifestPath,counts:{},rows:[],certifiedStudies:0,alternativeEvOracleRoots:0,diskProjection:projection};
  const priorById=new Map((campaign.rows||[]).map(r=>[r.jobId,r]));
  for(const [i,row] of jobs.entries()){
    const result=await executeHighRakeJob({manifestDir:materialized.outDir,row,solverPath:toolchain.solver.path,proofPath:toolchain.solutionProof.path,resume:true});
    priorById.set(row.id,{...result,split:row.split,checkedAt:now()});
    campaign.rows=[...priorById.values()];
    campaign.counts={};
    for(const r of campaign.rows) campaign.counts[r.status]=(campaign.counts[r.status]||0)+1;
    campaign.updatedAt=now();
    campaign.lastJob={index:i+1,total:jobs.length,id:row.id,split:row.split,status:result.status};
    state.campaigns[campaignKey]=campaign;saveState(workspace,state);
    console.log(`[${i+1}/${jobs.length}] ${row.split} ${row.id} -> ${result.status}`);
    if(!['VALIDATED_STRATEGY_ORACLE','RESUMED_VALIDATED_STRATEGY_ORACLE'].includes(result.status)){
      campaign.stopped=true;campaign.stopReason=`job_not_validated:${row.id}:${result.status}`;campaign.finishedAt=now();saveState(workspace,state);
      throw new Error(campaign.stopReason);
    }
  }
  campaign.stopped=false;campaign.finishedAt=now();campaign.note='Validated, gzip-archived strategy oracles only. Per-action EV extraction, independent teacher consensus and certified study authority remain separate gates.';
  state.campaigns[campaignKey]=campaign;saveState(workspace,state);
  return campaign;
}

const mode=arg('--mode','preflight');
const workspace=path.resolve(arg('--workspace',workspaceDefault));
fs.mkdirSync(workspace,{recursive:true});
const preflight=hardwareReport(workspace);
jsonWrite(path.join(workspace,'preflight.json'),preflight);
console.log(JSON.stringify({mode,workspace,preflight},null,2));

if(mode==='preflight') process.exit(0);
if(mode==='prepare'){
  if(!preflight.commands.git||!preflight.commands.cargo) throw new Error('prepare_requires_git_and_cargo');
  const toolchain=buildPinnedToolchain(workspace);
  console.log(JSON.stringify({ok:true,mode,toolchain,certifiedStudies:0},null,2));
}else if(mode==='probe'){
  const iterations=intArg('--iterations',100);
  const probe=await runProbe({workspace,preflight,iterations});
  console.log(JSON.stringify({ok:probe.passed,mode,probe},null,2));
  if(!probe.passed) process.exitCode=2;
}else if(mode==='pilot'){
  const pilot=await runPilot({workspace,preflight});
  console.log(JSON.stringify({ok:pilot.passed,mode,pilot},null,2));
  if(!pilot.passed) process.exitCode=2;
}else if(mode==='campaign'){
  const state=loadState(workspace);
  const threads=intArg('--threads',state?.pilot?.threads??preflight?.recommendation?.campaignThreads??1);
  const maxJobs=intArg('--max',null);
  const split=arg('--split',null);
  const campaign=await runCampaign({workspace,preflight,threads,maxJobs,onlySplit:split});
  console.log(JSON.stringify({ok:true,mode,threads,counts:campaign.counts,rows:campaign.rows.length,diskProjection:campaign.diskProjection,certifiedStudies:0,alternativeEvOracleRoots:0},null,2));
}else if(!['preflight','prepare','probe','pilot','campaign'].includes(mode)){
  throw new Error(`invalid_mode:${mode}`);
}
