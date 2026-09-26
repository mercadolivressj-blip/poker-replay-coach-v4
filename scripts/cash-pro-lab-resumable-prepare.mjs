import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HIGHRake_POSTFLOP_ENGINE } from '../src/cash-pro-lab/highrake-postflop-job-builder.js';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=path.join(repoRoot,'.cash-pro-lab','local-worker');
const vendorDir=path.join(workspace,'vendor');
const sourceDir=path.join(vendorDir,'postflop');
const toolManifest=path.join(repoRoot,'tools','highrake-action-ev','Cargo.toml');
const exe=n=>process.platform==='win32'?`${n}.exe`:n;
const solver=path.join(sourceDir,'target','release',exe('solver'));
const actionEv=path.join(repoRoot,'tools','highrake-action-ev','target','release',exe('cash-pro-lab-action-ev'));
const solutionProof=path.join(repoRoot,'tools','highrake-action-ev','target','release',exe('solution-proof'));
const solutionNashconv=path.join(repoRoot,'tools','highrake-action-ev','target','release',exe('solution-nashconv'));

function run(cmd,args,{cwd=repoRoot,capture=false}={}){
  const r=spawnSync(cmd,args,{cwd,stdio:capture?['ignore','pipe','pipe']:'inherit',encoding:capture?'utf8':undefined,shell:false});
  if(r.error) throw r.error;
  if((r.status??1)!==0) throw new Error(`command_failed:${cmd}:${r.status}${capture?`:${String(r.stderr||'').trim()}`:''}`);
  return r;
}
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function writeJson(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2));}

fs.mkdirSync(vendorDir,{recursive:true});
if(!fs.existsSync(path.join(sourceDir,'.git'))){
  run('git',['clone','--filter=blob:none','https://github.com/ucsandman/postflop.git',sourceDir]);
}
const have=spawnSync('git',['-C',sourceDir,'cat-file','-e',`${HIGHRake_POSTFLOP_ENGINE.sourceCommit}^{commit}`],{stdio:'ignore'}).status===0;
if(!have) run('git',['-C',sourceDir,'fetch','origin',HIGHRake_POSTFLOP_ENGINE.sourceCommit,'--depth=1']);
run('git',['-C',sourceDir,'checkout','--detach',HIGHRake_POSTFLOP_ENGINE.sourceCommit]);
run('git',['-C',sourceDir,'reset','--hard',HIGHRake_POSTFLOP_ENGINE.sourceCommit]);
run('git',['-C',sourceDir,'clean','-fd']);
const head=String(run('git',['-C',sourceDir,'rev-parse','HEAD'],{capture:true}).stdout||'').trim();
if(head!==HIGHRake_POSTFLOP_ENGINE.sourceCommit) throw new Error(`solver_source_commit_mismatch:${head}`);

const patch=HIGHRake_POSTFLOP_ENGINE.localPatch;
if(patch?.kind!=='deterministic-rewrite-script') throw new Error(`unexpected_patch_kind:${patch?.kind}`);
const patchPath=path.join(repoRoot,patch.file);
if(!fs.existsSync(patchPath)) throw new Error(`patch_script_missing:${patchPath}`);
run(process.execPath,[patchPath,sourceDir]);
run('git',['-C',sourceDir,'diff','--check']);
const solveText=fs.readFileSync(path.join(sourceDir,'cli','src','solve.rs'),'utf8');
const cfrText=fs.readFileSync(path.join(sourceDir,'engine','src','cfr.rs'),'utf8');
const nlheText=fs.readFileSync(path.join(sourceDir,'engine','src','nlhe.rs'),'utf8');
for(const marker of ['--target-confirmations','save_checkpoint(path, checkpoint_fingerprint)','restore_checkpoint(path, checkpoint_fingerprint)']){
  if(!solveText.includes(marker)) throw new Error(`patched_solve_marker_missing:${marker}`);
}
for(const marker of ['PFCFRCP1','pub fn save_checkpoint','pub fn restore_checkpoint']){
  if(!cfrText.includes(marker)) throw new Error(`patched_cfr_marker_missing:${marker}`);
}
if(!nlheText.includes('self.icm.is_none() && self.cfg.rake.percent == 0.0')) throw new Error('patched_rake_nashconv_marker_missing');

run('cargo',['build','--release','--manifest-path',path.join(sourceDir,'Cargo.toml'),'--bin','solver']);
for(const bin of ['cash-pro-lab-action-ev','solution-proof','solution-nashconv']){
  run('cargo',['build','--release','--manifest-path',toolManifest,'--bin',bin]);
}
for(const file of [solver,actionEv,solutionProof,solutionNashconv]) if(!fs.existsSync(file)) throw new Error(`binary_missing:${file}`);

const smokeDir=path.join(workspace,'toolchain-smoke-resume-v2');
fs.rmSync(smokeDir,{recursive:true,force:true});
fs.mkdirSync(smokeDir,{recursive:true});
const config=path.join(smokeDir,'spot.toml');
const checkpoint=path.join(smokeDir,'state.bin');
const output=path.join(smokeDir,'solution.json');
const verify=path.join(smokeDir,'verify.json');
fs.writeFileSync(config,`board = "Ks 7d 2c 8h 3d"\noop_range = "KK,A4s,A5s"\nip_range = "TT,JJ"\neffective_stack = 10.0\nstarting_pot = 10.0\nallin_threshold = 1.5\nraise_cap = 0\ntarget_exploitability = 0.000001\nmax_iterations = 2\nalpha = 1.5\nbeta = 0.0\ngamma = 2.0\nturn_chance_sampling = false\nregret_floor = false\n\n[rake]\npercent = 5.0\ncap = 2.5\n\n[sizings.oop.river]\nbet = { percents = [100.0] }\n\n[sizings.ip.river]\nbet = { percents = [100.0] }\n`);
const first=run(solver,['solve','--config',config,'--report-every','1','--threads','1','--max-iterations','1','--checkpoint',checkpoint],{capture:true});
if(!fs.existsSync(checkpoint)||fs.statSync(checkpoint).size<100) throw new Error('checkpoint_smoke_not_written');
if(!/iter\s+1\s+NashConv/.test(String(first.stdout||''))) throw new Error('checkpoint_smoke_first_report_missing');
const second=run(solver,['solve','--config',config,'--report-every','1','--threads','1','--max-iterations','2','--checkpoint',checkpoint,'--resume',checkpoint,'--out',output],{capture:true});
const secondOut=String(second.stdout||'');
if(!/resumed checkpoint .* iteration 1/.test(secondOut)) throw new Error(`checkpoint_resume_marker_missing:${secondOut.slice(-2000)}`);
if(!/iter\s+2\s+NashConv/.test(secondOut)) throw new Error(`checkpoint_resume_iter2_missing:${secondOut.slice(-2000)}`);
if(!fs.existsSync(output)) throw new Error('checkpoint_resume_solution_missing');
run(solutionNashconv,[output,verify,'0.0002'],{capture:true});
const verified=JSON.parse(fs.readFileSync(verify,'utf8'));
if(verified?.verified!==true||!Number.isFinite(Number(verified?.nashconv_pct_of_pot))) throw new Error('independent_nashconv_smoke_failed');

const manifest={
  version:'cash-pro-lab-local-toolchain-v3',
  generatedAt:new Date().toISOString(),
  platform:process.platform,
  arch:process.arch,
  hardware:{logicalCpus:os.cpus().length,totalMemGB:Number((os.totalmem()/1024**3).toFixed(2))},
  engine:{...HIGHRake_POSTFLOP_ENGINE},
  localPatch:{id:patch.id,file:patch.file,kind:patch.kind,patchSha256:sha(patchPath),cfrSha256:sha(path.join(sourceDir,'engine','src','cfr.rs')),nlheSha256:sha(path.join(sourceDir,'engine','src','nlhe.rs')),solveCliSha256:sha(path.join(sourceDir,'cli','src','solve.rs'))},
  solver:{path:solver,sha256:sha(solver)},
  actionEv:{path:actionEv,sha256:sha(actionEv)},
  solutionProof:{path:solutionProof,sha256:sha(solutionProof)},
  solutionNashconv:{path:solutionNashconv,sha256:sha(solutionNashconv)},
  smoke:{version:'cash-pro-lab-resume-smoke-v2',ok:true,resumedFrom:1,finishedAt:2,checkpointBytes:fs.statSync(checkpoint).size,verifiedNashconvPct:verified.nashconv_pct_of_pot},
  authority:{productionStrategy:false,certifiedStudies:0},
};
writeJson(path.join(workspace,'toolchain.json'),manifest);
console.log(JSON.stringify({ok:true,mode:'prepare-resumable',workspace,toolchain:manifest},null,2));
