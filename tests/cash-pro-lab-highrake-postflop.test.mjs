import assert from 'node:assert/strict';
import test from 'node:test';
import { create100zSrpFlopSolveRoot } from '../src/cash-pro-lab/solve-root.js';
import { RANGE_PROFILE_100Z_SRP } from '../src/cash-pro-lab/range-profile-100z.js';
import { CURRENT_100Z_SRP_PREFLOP_MODEL_KEY, CURRENT_100Z_SRP_TREE_PROFILE } from '../src/cash-pro-lab/solver-campaign-profile.js';
import { buildHighRakePostflopFlopJob } from '../src/cash-pro-lab/highrake-postflop-job-builder.js';
import { validateHighRakePostflopSolution } from '../src/cash-pro-lab/highrake-postflop-solution-validator.js';

function makeRoot(){
  return create100zSrpFlopSolveRoot({
    board:['Qs','Jh','2h'],openerPosition:'BTN',defenderPosition:'BB',startingStackBB:100,effectiveStackBB:97.5,potBB:5.5,
    rakeProfile:RANGE_PROFILE_100Z_SRP.rakeProfile,strategyProfile:RANGE_PROFILE_100Z_SRP.profileId,
    preflopModelProfile:CURRENT_100Z_SRP_PREFLOP_MODEL_KEY,sourceRef:'test-fixture',
  });
}
function build(){
  const out=buildHighRakePostflopFlopJob({root:makeRoot(),treeProfile:CURRENT_100Z_SRP_TREE_PROFILE});
  assert.equal(out.ok,true,JSON.stringify(out.errors));
  return out.job;
}
function solutionFor(job,overrides={}){
  const config={
    board:job.root.board.join(' '),oop_range:job.expectedRanges.oop,ip_range:job.expectedRanges.ip,
    effective_stack:job.root.effectiveStackBB,starting_pot:job.root.potBB,target_exploitability:job.convergence.targetExploitabilityPct,
    turn_chance_sampling:false,rake:{percent:job.rake.percent,cap:job.rake.cap},
  };
  const solution={
    format_version:1,config,
    meta:{iterations:1250,exploitability_chips:0.01,exploitability_pct_of_pot:0.18,root_evs:{zero_sum:[-0.2,0.15],pot_share:[2.55,2.7]},wall_seconds:12.3,engine_version:'0.1.0',payoff_unit:'chips',gain:[0.004,0.006]},
    node_count:3,
    nodes:[{node:0,player:0,actions:[{kind:'Check'},{kind:'Bet',amount:1.82}],combo_count:2,strategy:[0.7,0.2,0.3,0.8]}],
    root_combos:[[{index:1,cards:'AhKh'}],[{index:2,cards:'AsKs'}]],
  };
  return {...solution,...overrides,config:{...config,...(overrides.config||{})},meta:{...solution.meta,...(overrides.meta||{})}};
}

test('high-rake builder derives 5 percent / 2.5bb cap from the frozen 100z baseline',()=>{
  const job=build();
  assert.equal(job.rake.percent,5);
  assert.equal(job.rake.cap,2.5);
  assert.equal(job.rake.sourceBaselineVersion,'cash6max-100z-highrake-v1');
  assert.match(job.configToml,/\[rake\]\npercent = 5\.0\ncap = 2\.5/);
  assert.match(job.configToml,/turn_chance_sampling = false/);
  assert.match(job.configToml,/target_exploitability = 0\.25/);
  assert.match(job.configToml,/\[sizings\.oop\.flop\]/);
  assert.match(job.configToml,/bet = \{ percents = \[33\.0, 75\.0\], allin = true \}/);
  assert.equal(job.authority.highRakeDomain,true);
  assert.equal(job.authority.strategyOracleCandidate,true);
  assert.equal(job.authority.evAlternativeOracleCandidate,false);
});

test('validated high-rake solution earns strategy authority but never fake alternative-EV authority',()=>{
  const job=build();
  const validated=validateHighRakePostflopSolution({solution:solutionFor(job),job});
  assert.equal(validated.ok,true,JSON.stringify(validated.errors));
  assert.equal(validated.authority.highRakeDomain,true);
  assert.equal(validated.authority.strategyOracleReady,true);
  assert.equal(validated.authority.evAlternativeOracleReady,false);
  assert.equal(validated.authority.certifiedStudy,false);
});

test('wrong rake, chance sampling, weak convergence or malformed strategy destroys high-rake authority',()=>{
  const job=build();
  const wrongRake=validateHighRakePostflopSolution({solution:solutionFor(job,{config:{rake:{percent:0,cap:0}}}),job});
  assert.equal(wrongRake.ok,false);
  assert.ok(wrongRake.errors.includes('config_rake_percent_mismatch'));
  const sampled=validateHighRakePostflopSolution({solution:solutionFor(job,{config:{turn_chance_sampling:true}}),job});
  assert.equal(sampled.ok,false);
  assert.ok(sampled.errors.includes('chance_sampling_must_be_false'));
  const weak=validateHighRakePostflopSolution({solution:solutionFor(job,{meta:{exploitability_pct_of_pot:0.4}}),job});
  assert.equal(weak.ok,false);
  assert.ok(weak.errors.includes('exploitability_target_not_met'));
  const badStrategy=solutionFor(job);
  badStrategy.nodes[0].strategy=[0.7,0.2,0.2,0.7];
  const malformed=validateHighRakePostflopSolution({solution:badStrategy,job});
  assert.equal(malformed.ok,false);
  assert.ok(malformed.errors.includes('decision_node_strategy_column_not_normalized'));
});
