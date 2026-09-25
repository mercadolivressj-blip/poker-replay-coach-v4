import assert from 'node:assert/strict';
import test from 'node:test';
import { createDecisionNode } from '../src/cash-pro-lab/decision-node.js';
import { RANGE_PROFILE_100Z_SRP } from '../src/cash-pro-lab/range-profile-100z.js';
import { createSolverTreeProfile } from '../src/cash-pro-lab/solver-tree-profile.js';
import { buildTexasSolverFlopJob } from '../src/cash-pro-lab/texassolver-job-builder.js';

function treeProfile(overrides={}){
  return {
    profileId:'srp-hu-tree-a',profileVersion:'1',description:'fixture explicit tree',
    tree:{
      oop:{
        flop:{bet:[33,75],raise:[50],allin:true},
        turn:{bet:[50,100],raise:[50],allin:true},
        river:{bet:[50,100],raise:[50,100],donk:[50],allin:true},
      },
      ip:{
        flop:{bet:[33,75],raise:[50],allin:true},
        turn:{bet:[50,100],raise:[50],allin:true},
        river:{bet:[50,100],raise:[50,100],allin:true},
      },
    },
    allinThreshold:.67,
    compute:{threadNum:8,accuracy:.5,maxIteration:200,printInterval:10,dumpRounds:2,useIsomorphism:true},
    ...overrides,
  };
}

function flopRoot(overrides={}){
  return createDecisionNode({
    handId:'solve-root',decisionId:'flop-root',heroCards:['Ah','Kd'],board:['As','7c','2d'],street:'flop',heroPosition:'BB',
    startingStackBB:100,effectiveStackBB:97.5,heroStackBB:97.5,potBB:5.5,toCallBB:0,activePlayers:2,
    legalActions:['CHECK','BET'],legalOptions:[{id:'CHECK',action:'CHECK'},{id:'BET:1.8',action:'BET',amountBB:1.8}],
    rakeProfile:RANGE_PROFILE_100Z_SRP.rakeProfile,strategyProfile:RANGE_PROFILE_100Z_SRP.profileId,
    actionHistory:[
      {seq:1,street:'preflop',actorPosition:'BTN',action:'RAISE',amountBB:2.5},
      {seq:2,street:'preflop',actorPosition:'BB',action:'CALL',amountBB:1.5},
    ],
    ...overrides,
  });
}

test('solver tree profile rejects partial implicit trees',()=>{
  const out=createSolverTreeProfile({
    profileId:'partial',profileVersion:'1',
    tree:{oop:{flop:{bet:[50],raise:[50],allin:true}}},
    allinThreshold:.67,
    compute:{threadNum:4,accuracy:1,maxIteration:100,printInterval:10,dumpRounds:2,useIsomorphism:true},
  });
  assert.equal(out.ok,false);
  assert.ok(out.errors.includes('tree_row_missing:ip:river'));
  assert.ok(out.errors.includes('tree_row_missing:oop:turn'));
});

test('solver tree profile requires explicit bet raise and allin policy for every street and side',()=>{
  const bad=treeProfile();
  delete bad.tree.ip.turn.raise;
  const out=createSolverTreeProfile(bad);
  assert.equal(out.ok,false);
  assert.ok(out.errors.includes('tree_kind_missing:ip:turn:raise'));
});

test('TexasSolver flop job uses current stack behind, frozen SRP ranges and explicit full tree',()=>{
  const node=flopRoot();
  const result=buildTexasSolverFlopJob({node,treeProfile:treeProfile(),outputFile:'fixture-output.json'});
  assert.equal(result.ok,true);
  assert.equal(result.job.root.startingStackBB,100);
  assert.equal(result.job.root.effectiveStackBB,97.5);
  assert.equal(result.job.strategyProfile,RANGE_PROFILE_100Z_SRP.profileId);
  assert.equal(result.job.treeProfile.key,'srp-hu-tree-a@1');
  assert.equal(result.job.outputFile,'fixture-output.json');
  assert.match(result.job.commandText,/^set_pot 5\.5$/m);
  assert.match(result.job.commandText,/^set_effective_stack 97\.5$/m);
  assert.match(result.job.commandText,/^set_board As,7c,2d$/m);
  assert.match(result.job.commandText,/^set_range_ip .+$/m);
  assert.match(result.job.commandText,/^set_range_oop .+$/m);
  assert.match(result.job.commandText,/^set_bet_sizes oop,flop,bet,33,75$/m);
  assert.match(result.job.commandText,/^set_bet_sizes ip,river,raise,50,100$/m);
  assert.match(result.job.commandText,/^set_allin_threshold 0\.67$/m);
  assert.match(result.job.commandText,/^build_tree$/m);
  assert.match(result.job.commandText,/^start_solve$/m);
  assert.match(result.job.commandText,/^dump_result fixture-output\.json$/m);
});

test('TexasSolver job builder rejects a turn node because ranges must enter at the certified flop root',()=>{
  const node=flopRoot({board:['As','7c','2d','9h'],street:'turn'});
  const result=buildTexasSolverFlopJob({node,treeProfile:treeProfile()});
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('flop_root_required'));
});

test('TexasSolver job builder rejects a non-100bb starting profile instead of reusing 100z ranges',()=>{
  const node=flopRoot({startingStackBB:50,effectiveStackBB:47.5,heroStackBB:47.5});
  const result=buildTexasSolverFlopJob({node,treeProfile:treeProfile()});
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('range_profile:starting_stack_not_100bb'));
});

test('TexasSolver job builder rejects an incomplete tree profile before producing commands',()=>{
  const node=flopRoot();
  const result=buildTexasSolverFlopJob({
    node,
    treeProfile:{profileId:'bad',profileVersion:'1',tree:{},allinThreshold:.67,compute:{threadNum:1,accuracy:1,maxIteration:10,printInterval:1,dumpRounds:1,useIsomorphism:true}},
  });
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(e=>e.startsWith('tree_profile:tree_row_missing:')));
  assert.equal(result.job,null);
});
