import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeHighRakeJob, validateHighRakeManifest } from './lib/cash-pro-lab-highrake-runner.mjs';
import { HIGHRake_POSTFLOP_ENGINE } from '../src/cash-pro-lab/highrake-postflop-job-builder.js';
import { evaluateLocalSolveWorkerHardware, unlockCampaignAfterPilot } from '../src/cash-pro-lab/local-solve-worker-profile.js';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspaceDefault=path.join(repoRoot,'.cash-pro-lab','local-worker');

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
  try{const s=fs.statfsSync(target);return Number(s.bavail)*Number(s.bsize)/1024**3;}catch{return NaN;}
}
function hardwareReport(workspace){
  fs.mkdirSync(workspace,{recursive:true});
  const report=evaluateLocalSolveWorkerHardware({
    logicalCpus:os.cpus().length,
    totalMemGB:os.totalmem()/1024**3,
    freeMemGB:os.freemem()/1024**3,
    freeDiskGB:freeDiskGB(workspace),
  });
  return {
    version:'cash-pro-lab-local-pc-preflight-v1',
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
function buildPinnedToolchain(workspace){
  if(!commandExists('git')) throw new Error('git_missing');
  if(!commandExists('cargo')) throw new Error('cargo_missing_install_rustup_first');
  const vendorDir=path.join(workspace,'vendor');
  const sourceDir=path.join(vendorDir,'postflop');
  fs.mkdirSync(vendorDir,{recursive:true});
  if(!fs.existsSync(path.join(sourceDir,'.git'))){
    run('git',['clone','--filter=blob:none','https://github.com/ucsandman/postflop.git',sourceDir]);
  }
  let hasCommit=run('git',['-C',sourceDir,'cat-file','-e',`${HIGHRake_POSTFLOP_ENGINE.sourceCommit}^{commit}`],{allowFailure:true,capture:true}).status===0;
  if(!hasCommit){
    run('git',['-C',sourceDir,'fetch','origin',HIGHRake_POSTFLOP_ENGINE.sourceCommit,'--depth=1']);
  }
  run('git',['-C',sourceDir,'checkout','--detach',HIGHRake_POSTFLOP_ENGINE.sourceCommit]);
  const head=String(run('git',['-C',sourceDir,'rev-parse','HEAD'],{capture:true}).stdout||'').trim();
  if(head!==HIGHRake_POSTFLOP_ENGINE.sourceCommit) throw new Error(`solver_source_commit_mismatch:${head}`);
  run('cargo',['build','--release','--manifest-path',path.join(sourceDir,'Cargo.toml'),'--bin','solver']);
  run('cargo',['build','--release','--manifest-path',path.join(repoRoot,'tools','highrake-action-ev','Cargo.toml')]);
  const solver=solverBinaryPath(sourceDir),actionEv=actionEvBinaryPath();
  if(!fs.existsSync(solver)||!fs.existsSync(actionEv)) throw new Error('toolchain_binary_missing_after_build');
  const manifest={
    version:'cash-pro-lab-local-toolchain-v1',generatedAt:now(),
    engine:{...HIGHRake_POSTFLOP_ENGINE},
    solver:{path:solver,sha256:sha256File(solver)},
    actionEv:{path:actionEv,sha256:sha256File(actionEv)},
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
  if(manifest?.engine?.sourceCommit!==HIGHRake_POSTFLOP_ENGINE.sourceCommit) errors.push('toolchain_source_commit_mismatch');
  if(sha256File(manifest.solver.path)!==manifest.solver.sha256) errors.push('solver_binary_sha256_mismatch');
  if(!manifest?.actionEv?.path||!fs.existsSync(manifest.actionEv.path)||sha256File(manifest.actionEv.path)!==manifest.actionEv.sha256) errors.push('action_ev_binary_sha256_mismatch');
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
function loadState(workspace){return jsonRead(statePath(workspace),{version:'cash-pro-lab-local-worker-state-v1',createdAt:now(),pilot:null,campaigns:{}});}
function saveState(workspace,state){state.updatedAt=now();jsonWrite(statePath(workspace),state);}
async function runPilot({workspace,preflight}){
  if(!preflight?.pilot?.allowed) throw new Error(`pilot_blocked:${(preflight?.pilot?.reasons||[]).join(',')}`);
  const toolchain=requireToolchain(workspace);
  const materialized=materializeCampaign({workspace,threads:1,split:'train',max:1,label:'pilot-production-quality'});
  const row=materialized.manifest.jobs[0];
  if(!row) throw new Error('pilot_job_missing');
  const startedAt=now();
  const result=await executeHighRakeJob({manifestDir:materialized.outDir,row,solverPath:toolchain.solver.path,resume:true});
  const passed=['VALIDATED_STRATEGY_ORACLE','RESUMED_VALIDATED_STRATEGY_ORACLE'].includes(result.status);
  const state=loadState(workspace);
  state.pilot={version:'cash-pro-lab-local-production-pilot-v1',startedAt,finishedAt:now(),passed,rowId:row.id,split:row.split,result,hardware:preflight.hardware,solverSha256:toolchain.solver.sha256,manifestPath:materialized.manifestPath,authority:{certifiedStudies:0,productionCampaignUnlocked:passed}};
  saveState(workspace,state);
  return state.pilot;
}
function splitRank(s){return s==='train'?0:s==='dev'?1:2;}
async function runCampaign({workspace,preflight,threads,maxJobs=null,onlySplit=null}){
  const state=loadState(workspace);
  const unlocked=unlockCampaignAfterPilot(preflight,{pilotPassed:state?.pilot?.passed===true});
  if(!unlocked.allowed) throw new Error(`campaign_blocked:${unlocked.reasons.join(',')}`);
  const toolchain=requireToolchain(workspace);
  const materialized=materializeCampaign({workspace,threads,label:'production-campaign'});
  let jobs=[...materialized.manifest.jobs].sort((a,b)=>splitRank(a.split)-splitRank(b.split)||a.id.localeCompare(b.id));
  if(onlySplit){if(!['train','dev','holdout'].includes(onlySplit))throw new Error(`invalid_split:${onlySplit}`);jobs=jobs.filter(j=>j.split===onlySplit);}
  if(maxJobs!=null) jobs=jobs.slice(0,maxJobs);
  const campaignKey=`${materialized.manifest.campaignId}:threads=${threads}`;
  const campaign=state.campaigns[campaignKey]??{version:'cash-pro-lab-local-production-campaign-v1',startedAt:now(),threads,manifestPath:materialized.manifestPath,counts:{},rows:[],certifiedStudies:0,alternativeEvOracleRoots:0};
  const priorById=new Map((campaign.rows||[]).map(r=>[r.jobId,r]));
  for(const [i,row] of jobs.entries()){
    const result=await executeHighRakeJob({manifestDir:materialized.outDir,row,solverPath:toolchain.solver.path,resume:true});
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
  campaign.stopped=false;campaign.finishedAt=now();campaign.note='Validated strategy oracles only. Per-action EV extraction, independent teacher consensus and certified study authority remain separate gates.';
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
}else if(mode==='pilot'){
  const pilot=await runPilot({workspace,preflight});
  console.log(JSON.stringify({ok:pilot.passed,mode,pilot},null,2));
  if(!pilot.passed) process.exitCode=2;
}else if(mode==='campaign'){
  const threads=intArg('--threads',preflight?.recommendation?.campaignThreads??1);
  const maxJobs=intArg('--max',null);
  const split=arg('--split',null);
  const campaign=await runCampaign({workspace,preflight,threads,maxJobs,onlySplit:split});
  console.log(JSON.stringify({ok:true,mode,threads,counts:campaign.counts,rows:campaign.rows.length,certifiedStudies:0,alternativeEvOracleRoots:0},null,2));
}else if(!['preflight','prepare','pilot','campaign'].includes(mode)){
  throw new Error(`invalid_mode:${mode}`);
}
