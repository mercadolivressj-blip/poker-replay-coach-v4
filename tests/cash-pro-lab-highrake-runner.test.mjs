import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { create100zSrpFlopSolveRoot } from '../src/cash-pro-lab/solve-root.js';
import { RANGE_PROFILE_100Z_SRP } from '../src/cash-pro-lab/range-profile-100z.js';
import { CURRENT_100Z_SRP_PREFLOP_MODEL_KEY, CURRENT_100Z_SRP_TREE_PROFILE } from '../src/cash-pro-lab/solver-campaign-profile.js';
import { buildHighRakePostflopFlopJob } from '../src/cash-pro-lab/highrake-postflop-job-builder.js';
import { archiveSolutionFile, buildValidatedHighRakeSidecar, sha256GzipContent, validateHighRakeManifest, validateHighRakeResume } from '../scripts/lib/cash-pro-lab-highrake-runner-v2.mjs';

const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function row(){
  const root=create100zSrpFlopSolveRoot({
    board:['Qs','Jh','2h'],openerPosition:'BTN',defenderPosition:'BB',startingStackBB:100,effectiveStackBB:97.5,potBB:5.5,
    rakeProfile:RANGE_PROFILE_100Z_SRP.rakeProfile,strategyProfile:RANGE_PROFILE_100Z_SRP.profileId,
    preflopModelProfile:CURRENT_100Z_SRP_PREFLOP_MODEL_KEY,sourceRef:'runner-test',
  });
  const built=buildHighRakePostflopFlopJob({root,treeProfile:CURRENT_100Z_SRP_TREE_PROFILE});
  assert.equal(built.ok,true);
  return {id:built.job.providerFingerprint,split:'train',configFile:'configs/train/a.toml',outputFile:'outputs/train/a.json',job:built.job};
}
function solution(r){
  const j=r.job;
  const chips=0.01;
  return {
    format_version:1,
    config:{board:j.root.board.join(' '),oop_range:j.expectedRanges.oop,ip_range:j.expectedRanges.ip,effective_stack:j.root.effectiveStackBB,starting_pot:j.root.potBB,target_exploitability:j.convergence.targetExploitabilityPct,turn_chance_sampling:false,rake:{percent:5,cap:2.5}},
    meta:{iterations:1000,exploitability_chips:chips,exploitability_pct_of_pot:100*chips/j.root.potBB,root_evs:{zero_sum:[-0.1,0.05],pot_share:[2.6,2.65]},wall_seconds:1,engine_version:'fixture',payoff_unit:'chips',gain:[0.005,0.005]},
    node_count:2,nodes:[{node:0,player:0,actions:[{kind:'Check'},{kind:'Bet',amount:1.82}],combo_count:1,strategy:[0.6,0.4]}],root_combos:[[{index:1,cards:'AhKh'}],[{index:2,cards:'AsKs'}]],
  };
}

test('high-rake manifest rejects provider, rake, patch or convergence metric drift',()=>{
  const r=row();
  const base={version:'cash-pro-lab-highrake-external-manifest-v1',campaignId:'fixture',jobs:[r]};
  assert.equal(validateHighRakeManifest(base).ok,true);
  assert.equal(validateHighRakeManifest({...base,jobs:[{...r,job:{...r.job,rake:{...r.job.rake,percent:0}}}]}).ok,false);
  assert.equal(validateHighRakeManifest({...base,jobs:[{...r,job:{...r.job,provider:'other'}}]}).ok,false);
  assert.equal(validateHighRakeManifest({...base,jobs:[{...r,job:{...r.job,convergence:{...r.job.convergence,metric:'exploitability_pct_of_pot'}}}]}).ok,false);
  assert.equal(validateHighRakeManifest({...base,jobs:[{...r,job:{...r.job,engine:{...r.job.engine,localPatch:{id:'wrong'}}}}]}).ok,false);
});

test('validated sidecar binds solution config and exact solver binary while withholding study and alternative-EV authority',()=>{
  const r=row(),configText=r.job.configToml,binarySha256=sha(Buffer.from('solver-binary'));
  const solutionText=JSON.stringify(solution(r));
  const built=buildValidatedHighRakeSidecar({row:r,solutionText,configText,binarySha256,startedAt:'a',finishedAt:'b'});
  assert.equal(built.ok,true,JSON.stringify(built.errors));
  assert.equal(built.sidecar.status,'VALIDATED_STRATEGY_ORACLE');
  assert.equal(built.sidecar.strategyOracleReady,true);
  assert.equal(built.sidecar.evAlternativeOracleReady,false);
  assert.equal(built.sidecar.certifiedStudy,false);
  assert.equal(built.sidecar.solverBinarySha256,binarySha256);
  assert.equal(built.sidecar.configSha256,r.job.configSha256);
  assert.equal(built.sidecar.convergence.metric,'nashconv_pct_of_pot');
  assert.equal(validateHighRakeResume({row:r,solutionText,configText,binarySha256,sidecar:built.sidecar}).ok,true);
});

test('resume is invalidated by binary config output or authority tampering',()=>{
  const r=row(),configText=r.job.configToml,binarySha256=sha(Buffer.from('solver-binary')),solutionText=JSON.stringify(solution(r));
  const built=buildValidatedHighRakeSidecar({row:r,solutionText,configText,binarySha256,startedAt:'a',finishedAt:'b'});
  assert.equal(validateHighRakeResume({row:r,solutionText,configText,binarySha256:sha(Buffer.from('other')),sidecar:built.sidecar}).ok,false);
  assert.equal(validateHighRakeResume({row:r,solutionText,configText:`${configText}# drift\n`,binarySha256,sidecar:built.sidecar}).ok,false);
  const changed=JSON.stringify({...solution(r),meta:{...solution(r).meta,exploitability_pct_of_pot:0.1}});
  assert.equal(validateHighRakeResume({row:r,solutionText:changed,configText,binarySha256,sidecar:built.sidecar}).ok,false);
  assert.equal(validateHighRakeResume({row:r,solutionText,configText,binarySha256,sidecar:{...built.sidecar,certifiedStudy:true}}).ok,false);
});

test('solution archive hashes raw bytes and verifies gzip round trip without whole-file JSON parsing',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cash-lab-archive-'));
  const raw=path.join(dir,'solution.json'),gz=`${raw}.gz`;
  const body=JSON.stringify({hello:'world',strategy:Array.from({length:5000},(_,i)=>(i%10)/10)});
  fs.writeFileSync(raw,body);
  try{
    const out=await archiveSolutionFile(raw,gz);
    assert.equal(out.outputSha256,sha(Buffer.from(body)));
    assert.equal(out.decodedSha256,out.outputSha256);
    assert.equal(await sha256GzipContent(gz),out.outputSha256);
    assert.ok(out.archiveBytes>0);
    assert.ok(out.outputBytes>0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
