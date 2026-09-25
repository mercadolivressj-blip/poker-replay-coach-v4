import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFlopBoard } from '../src/cash-pro-lab/board-factory.js';
import { materializeCurrent100zSrpCampaign } from '../src/cash-pro-lab/solve-campaign-materializer.js';
import { buildHighRakePostflopFlopJob } from '../src/cash-pro-lab/highrake-postflop-job-builder.js';
import { CURRENT_100Z_SRP_TREE_PROFILE } from '../src/cash-pro-lab/solver-campaign-profile.js';

test('all 240 concrete 100z SRP roots remain split-clean and build exact high-rake configs',()=>{
  const campaign=materializeCurrent100zSrpCampaign();
  assert.equal(campaign.ok,true,JSON.stringify(campaign.errors));
  assert.equal(campaign.planner.uniqueAbstractRoots,240);
  assert.equal(campaign.planner.eligibleTickets,21600);
  assert.equal(campaign.planner.splitIntegrity.valid,true);
  assert.equal(campaign.materialized.concreteSplitLeakage.length,0);
  assert.equal(campaign.materialized.jobs,240);
  assert.deepEqual(campaign.materialized.bySplit,{train:197,dev:27,holdout:16,unknown:0});

  const fingerprints=new Set(),legacyOutputs=new Set(),highRakeIds=new Set(),highRakeConfigs=new Set();
  for(const row of campaign.jobs){
    assert.equal(row.rootProof.ok,true);
    assert.equal(row.root.startingStackBB,100);
    assert.equal(row.root.effectiveStackBB,97.5);
    assert.ok([5,5.5].includes(row.root.potBB));
    assert.equal(row.splits.length,1);
    assert.equal(row.splits[0],row.split);
    assert.equal(classifyFlopBoard(row.root.board).checks[row.abstractTexture],true);

    // Legacy TexasSolver path stays available for no-rake structural/parity work.
    assert.match(row.job.commandText,/^build_tree$/m);
    assert.match(row.job.commandText,/^start_solve$/m);
    assert.match(row.job.commandText,/^dump_result .+\.json$/m);

    // Primary cash teacher path must materialize the frozen 5% / 2.5bb-cap model.
    const high=buildHighRakePostflopFlopJob({root:row.root,treeProfile:CURRENT_100Z_SRP_TREE_PROFILE});
    assert.equal(high.ok,true,JSON.stringify(high.errors));
    assert.equal(high.job.rake.percent,5);
    assert.equal(high.job.rake.cap,2.5);
    assert.equal(high.job.convergence.turnChanceSampling,false);
    assert.equal(high.job.authority.highRakeDomain,true);
    assert.equal(high.job.authority.evAlternativeOracleCandidate,false);
    assert.match(high.job.configToml,/\[rake\]\npercent = 5\.0\ncap = 2\.5/);
    assert.equal(highRakeIds.has(high.job.providerFingerprint),false);
    highRakeIds.add(high.job.providerFingerprint);
    assert.equal(highRakeConfigs.has(high.job.configSha256),false);
    highRakeConfigs.add(high.job.configSha256);

    assert.equal(fingerprints.has(row.root.fingerprint),false);
    fingerprints.add(row.root.fingerprint);
    assert.equal(legacyOutputs.has(row.job.outputFile),false);
    legacyOutputs.add(row.job.outputFile);
  }
  assert.equal(highRakeIds.size,240);
  assert.equal(highRakeConfigs.size,240);

  console.log('CASH_PRO_LAB_MATERIALIZED_CAMPAIGN='+JSON.stringify({
    abstractRoots:campaign.planner.uniqueAbstractRoots,
    eligibleTickets:campaign.planner.eligibleTickets,
    concreteJobs:campaign.materialized.jobs,
    highRakeConfigs:highRakeConfigs.size,
    highRakeProviderFingerprints:highRakeIds.size,
    duplicateAbstractReferences:campaign.materialized.duplicateAbstractReferences,
    bySplit:campaign.materialized.bySplit,
    concreteSplitLeakage:campaign.materialized.concreteSplitLeakage.length,
  }));
});
