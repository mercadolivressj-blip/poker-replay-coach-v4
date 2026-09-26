import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLocalSolveWorkerHardware, unlockCampaignAfterPilot } from '../src/cash-pro-lab/local-solve-worker-profile.js';

test('blocks a production pilot below conservative memory guard',()=>{
  const r=evaluateLocalSolveWorkerHardware({logicalCpus:16,totalMemGB:16,freeMemGB:12,freeDiskGB:500});
  assert.equal(r.ok,true);
  assert.equal(r.pilot.allowed,false);
  assert.match(r.pilot.reasons.join(','),/total_memory_below_24gb_guard/);
});

test('allows pilot candidate but never auto-unlocks campaign before a real pilot',()=>{
  const r=evaluateLocalSolveWorkerHardware({logicalCpus:16,totalMemGB:64,freeMemGB:54,freeDiskGB:500});
  assert.equal(r.pilot.allowed,true);
  assert.equal(r.campaign.allowed,false);
  assert.equal(r.recommendation.pilotThreads,1);
  assert.equal(r.recommendation.campaignThreads,8);
  assert.deepEqual(unlockCampaignAfterPilot(r,{pilotPassed:false}),{allowed:false,reasons:['production_pilot_not_passed']});
});

test('campaign unlock still enforces free disk after pilot',()=>{
  const lowDisk=evaluateLocalSolveWorkerHardware({logicalCpus:12,totalMemGB:64,freeMemGB:50,freeDiskGB:80});
  assert.equal(unlockCampaignAfterPilot(lowDisk,{pilotPassed:true}).allowed,false);
  const enoughDisk=evaluateLocalSolveWorkerHardware({logicalCpus:12,totalMemGB:64,freeMemGB:50,freeDiskGB:250});
  assert.deepEqual(unlockCampaignAfterPilot(enoughDisk,{pilotPassed:true}),{allowed:true,reasons:[]});
});

test('invalid metrics never produce an eligible worker',()=>{
  const r=evaluateLocalSolveWorkerHardware({logicalCpus:0,totalMemGB:64,freeMemGB:50,freeDiskGB:250});
  assert.equal(r.ok,false);
  assert.equal(r.pilot.allowed,false);
  assert.equal(r.campaign.allowed,false);
});
