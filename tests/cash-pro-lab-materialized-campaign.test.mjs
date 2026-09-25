import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFlopBoard } from '../src/cash-pro-lab/board-factory.js';
import { materializeCurrent100zSrpCampaign } from '../src/cash-pro-lab/solve-campaign-materializer.js';

test('current exact 100z SRP campaign materializes solver-ready jobs without concrete split leakage',()=>{
  const campaign=materializeCurrent100zSrpCampaign();
  assert.equal(campaign.ok,true,JSON.stringify(campaign.errors));
  assert.equal(campaign.planner.uniqueAbstractRoots,240);
  assert.equal(campaign.planner.eligibleTickets,21600);
  assert.equal(campaign.planner.splitIntegrity.valid,true);
  assert.equal(campaign.materialized.concreteSplitLeakage.length,0);
  assert.ok(campaign.materialized.jobs>0);
  assert.ok(campaign.materialized.jobs<=240);
  assert.equal(Object.values(campaign.materialized.bySplit).reduce((a,b)=>a+b,0),campaign.materialized.jobs);

  const fingerprints=new Set();
  const outputs=new Set();
  for(const row of campaign.jobs){
    assert.equal(row.rootProof.ok,true);
    assert.equal(row.root.startingStackBB,100);
    assert.equal(row.root.effectiveStackBB,97.5);
    assert.ok([5,5.5].includes(row.root.potBB));
    assert.equal(row.splits.length,1);
    assert.equal(row.splits[0],row.split);
    assert.equal(classifyFlopBoard(row.root.board).checks[row.abstractTexture],true);
    assert.match(row.job.commandText,/^build_tree$/m);
    assert.match(row.job.commandText,/^start_solve$/m);
    assert.match(row.job.commandText,/^dump_result .+\.json$/m);
    assert.equal(fingerprints.has(row.root.fingerprint),false);
    fingerprints.add(row.root.fingerprint);
    assert.equal(outputs.has(row.job.outputFile),false);
    outputs.add(row.job.outputFile);
  }

  console.log('CASH_PRO_LAB_MATERIALIZED_CAMPAIGN='+JSON.stringify({
    abstractRoots:campaign.planner.uniqueAbstractRoots,
    eligibleTickets:campaign.planner.eligibleTickets,
    concreteJobs:campaign.materialized.jobs,
    duplicateAbstractReferences:campaign.materialized.duplicateAbstractReferences,
    bySplit:campaign.materialized.bySplit,
    concreteSplitLeakage:campaign.materialized.concreteSplitLeakage.length,
  }));
});
