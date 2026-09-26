import { createPreflopModelProfile, preflopModelKey } from './preflop-model-profile.js';
import { createSolverTreeProfile, treeProfileKey } from './solver-tree-profile.js';

const PREFLOP_SOURCE='cash-pro-lab-model:100z-srp-open2.5-bbdefend-v1';

const preflopResult=createPreflopModelProfile({
  profileId:'cash-pro-lab-100z-srp-open2.5-bbdefend',
  profileVersion:'1',
  startingStackBB:100,
  description:'Explicit study-model economics for 100bb single-raised pots where one position opens 2.5bb and BB calls. This is a modeling profile, not an observed population claim.',
  matchups:{
    'UTG:BB':{openSizeBB:2.5,potBB:5.5,effectiveStackBB:97.5,sourceRef:PREFLOP_SOURCE},
    'HJ:BB':{openSizeBB:2.5,potBB:5.5,effectiveStackBB:97.5,sourceRef:PREFLOP_SOURCE},
    'CO:BB':{openSizeBB:2.5,potBB:5.5,effectiveStackBB:97.5,sourceRef:PREFLOP_SOURCE},
    'BTN:BB':{openSizeBB:2.5,potBB:5.5,effectiveStackBB:97.5,sourceRef:PREFLOP_SOURCE},
    'SB:BB':{openSizeBB:2.5,potBB:5.0,effectiveStackBB:97.5,sourceRef:PREFLOP_SOURCE},
  },
});
if(!preflopResult.ok) throw new Error(`invalid frozen preflop model profile: ${preflopResult.errors.join(',')}`);

const treeResult=createSolverTreeProfile({
  profileId:'cash-pro-lab-srp-hu-tree-a',
  profileVersion:'1',
  description:'Explicit reusable HU SRP study tree. Sizing abstraction is frozen so all campaign roots are directly comparable.',
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
});
if(!treeResult.ok) throw new Error(`invalid frozen solver tree profile: ${treeResult.errors.join(',')}`);

export const CURRENT_100Z_SRP_PREFLOP_MODEL=preflopResult.profile;
export const CURRENT_100Z_SRP_TREE_PROFILE=treeResult.profile;
export const CURRENT_100Z_SRP_PREFLOP_MODEL_KEY=preflopModelKey(CURRENT_100Z_SRP_PREFLOP_MODEL);
export const CURRENT_100Z_SRP_TREE_PROFILE_KEY=treeProfileKey(CURRENT_100Z_SRP_TREE_PROFILE);
export const CURRENT_100Z_SRP_CAMPAIGN_PROFILE=Object.freeze({
  version:'cash-pro-lab-solver-campaign-profile-v1',
  campaignId:'100z-srp-bb-defend-tree-a-v1',
  startingStackBB:100,
  preflopModelKey:CURRENT_100Z_SRP_PREFLOP_MODEL_KEY,
  treeProfileKey:CURRENT_100Z_SRP_TREE_PROFILE_KEY,
  sourceRef:PREFLOP_SOURCE,
  note:'Economics and tree abstraction are frozen inputs for study reproducibility. They are not population-frequency claims and do not certify solver output.',
});
