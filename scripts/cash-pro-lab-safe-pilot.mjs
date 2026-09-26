import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const workspace=path.join(repoRoot,'.cash-pro-lab','local-worker');
const statePath=path.join(workspace,'worker-state.json');
let state=null;
try{state=JSON.parse(fs.readFileSync(statePath,'utf8'));}catch{throw new Error('pilot_blocked:safe_probe_state_missing');}
const probe=state?.probe;
const reasons=[];
if(probe?.version!=='cash-pro-lab-production-safe-probe-v1') reasons.push('safe_probe_v1_required');
if(probe?.readyForPilot!==true) reasons.push('safe_probe_not_ready');
if(probe?.curveStatus!=='TARGET_STABLE') reasons.push('stable_target_not_proven');
if(!Array.isArray(probe?.curve)||probe.curve.length<3) reasons.push('checkpoint_curve_missing');
if(Number(probe?.requiredTargetConfirmations)!==3) reasons.push('target_confirmation_contract_mismatch');
if(probe?.artifactWritten!==false) reasons.push('probe_artifact_contract_invalid');
if(reasons.length) throw new Error(`pilot_blocked:${reasons.join(',')}`);

const r=spawnSync(process.execPath,[path.join(repoRoot,'scripts','cash-pro-lab-local-pc-worker.mjs'),'--mode','pilot'],{
  cwd:repoRoot,stdio:'inherit',shell:false,
});
if(r.error) throw r.error;
if((r.status??1)!==0) process.exitCode=r.status??2;
