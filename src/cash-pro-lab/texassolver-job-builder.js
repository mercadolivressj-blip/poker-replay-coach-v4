import { RANGE_PROFILE_100Z_SRP } from './range-profile-100z.js';
import { prove100zSrpFlopSolveRoot } from './solve-root.js';
import { createSolverTreeProfile, treeProfileKey } from './solver-tree-profile.js';

function numberText(v){
  if(Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(6)));
}

function safeFilename(value){
  return String(value||'solve').replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,160);
}

function profileOrError(treeProfile){
  if(treeProfile?.version==='cash-pro-lab-solver-tree-profile-v1') return {ok:true,profile:treeProfile,errors:[]};
  return createSolverTreeProfile(treeProfile||{});
}

export function buildTexasSolverFlopJob({root={},treeProfile,outputFile=null}={}){
  const rootProof=prove100zSrpFlopSolveRoot(root);
  const treeResult=profileOrError(treeProfile);
  const errors=[...rootProof.errors,...(treeResult.ok?[]:treeResult.errors.map(e=>`tree_profile:${e}`))];
  if(errors.length){
    return {version:'cash-pro-lab-texassolver-job-v2',ok:false,errors:[...new Set(errors)],rootProof,job:null};
  }

  const profile=treeResult.profile;
  const filename=safeFilename(outputFile||`${root.fingerprint}_${treeProfileKey(profile)}.json`);
  const lines=[
    `set_pot ${numberText(root.potBB)}`,
    `set_effective_stack ${numberText(root.effectiveStackBB)}`,
    `set_board ${root.board.join(',')}`,
    `set_range_ip ${root.rangeIp}`,
    `set_range_oop ${root.rangeOop}`,
  ];
  for(const action of profile.actions){
    if(action.kind==='allin') lines.push(`set_bet_sizes ${action.position},${action.street},allin`);
    else lines.push(`set_bet_sizes ${action.position},${action.street},${action.kind},${action.sizes.map(numberText).join(',')}`);
  }
  lines.push(
    `set_allin_threshold ${numberText(profile.allinThreshold)}`,
    'build_tree',
    `set_thread_num ${profile.compute.threadNum}`,
    `set_accuracy ${numberText(profile.compute.accuracy)}`,
    `set_max_iteration ${profile.compute.maxIteration}`,
    `set_print_interval ${profile.compute.printInterval}`,
    `set_use_isomorphism ${profile.compute.useIsomorphism}`,
    'start_solve',
    `set_dump_rounds ${profile.compute.dumpRounds}`,
    `dump_result ${filename}`,
  );

  return {
    version:'cash-pro-lab-texassolver-job-v2',
    ok:true,
    errors:[],
    rootProof,
    job:{
      solveRootFingerprint:root.fingerprint,
      solveRootFingerprintVersion:root.fingerprintVersion,
      strategyProfile:RANGE_PROFILE_100Z_SRP.profileId,
      preflopModelProfile:root.preflopModelProfile,
      rangeProfile:{
        profileId:RANGE_PROFILE_100Z_SRP.profileId,
        baselineVersion:RANGE_PROFILE_100Z_SRP.baselineVersion,
        snapshotSha256:RANGE_PROFILE_100Z_SRP.snapshotSha256,
        frequencyModel:RANGE_PROFILE_100Z_SRP.frequencyModel,
        openerPosition:root.openerPosition,
        defenderPosition:root.defenderPosition,
        ipPosition:root.ipPosition,
        oopPosition:root.oopPosition,
      },
      treeProfile:{
        profileId:profile.profileId,
        profileVersion:profile.profileVersion,
        key:treeProfileKey(profile),
        allinThreshold:profile.allinThreshold,
        actions:profile.actions,
      },
      computeProfile:{...profile.compute},
      root:{
        board:[...root.board],
        potBB:root.potBB,
        startingStackBB:root.startingStackBB,
        effectiveStackBB:root.effectiveStackBB,
      },
      outputFile:filename,
      commandText:`${lines.join('\n')}\n`,
      provenance:{
        solverFamily:'TexasSolver-external-export',
        builderVersion:'cash-pro-lab-texassolver-job-v2',
        sourceRef:root.sourceRef??null,
        note:'This file describes an external offline range solve. One solve root covers many private-card decision nodes. The builder does not execute TexasSolver and does not certify the resulting artifact by itself.',
      },
    },
  };
}
