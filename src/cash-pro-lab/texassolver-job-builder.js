import { infer100zSrpFromNode, RANGE_PROFILE_100Z_SRP } from './range-profile-100z.js';
import { createSolverTreeProfile, treeProfileKey } from './solver-tree-profile.js';

const finite=v=>typeof v==='number'&&Number.isFinite(v);

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

export function buildTexasSolverFlopJob({node={},treeProfile,outputFile=null}={}){
  const errors=[];
  if(node.street!=='flop'||!Array.isArray(node.board)||node.board.length!==3) errors.push('flop_root_required');
  if(!finite(node.potBB)||node.potBB<=0) errors.push('pot_missing');
  if(!finite(node.effectiveStackBB)||node.effectiveStackBB<=0) errors.push('effective_stack_missing');
  if(finite(node.startingStackBB)&&node.effectiveStackBB>node.startingStackBB+1e-9) errors.push('effective_stack_exceeds_starting_stack');

  const rangeResult=infer100zSrpFromNode(node);
  if(!rangeResult.ok) errors.push(...rangeResult.errors.map(e=>`range_profile:${e}`));
  const treeResult=profileOrError(treeProfile);
  if(!treeResult.ok) errors.push(...treeResult.errors.map(e=>`tree_profile:${e}`));
  if(errors.length){
    return {version:'cash-pro-lab-texassolver-job-v1',ok:false,errors:[...new Set(errors)],job:null};
  }

  const profile=treeResult.profile;
  const filename=safeFilename(outputFile||`${node.fingerprint}_${treeProfileKey(profile)}.json`);
  const lines=[
    `set_pot ${numberText(node.potBB)}`,
    `set_effective_stack ${numberText(node.effectiveStackBB)}`,
    `set_board ${node.board.join(',')}`,
    `set_range_ip ${rangeResult.rangeIp}`,
    `set_range_oop ${rangeResult.rangeOop}`,
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
    version:'cash-pro-lab-texassolver-job-v1',
    ok:true,
    errors:[],
    job:{
      nodeFingerprint:node.fingerprint,
      fingerprintVersion:node.fingerprintVersion,
      observationFingerprint:node.observationFingerprint??null,
      strategyProfile:RANGE_PROFILE_100Z_SRP.profileId,
      rangeProfile:{
        profileId:RANGE_PROFILE_100Z_SRP.profileId,
        baselineVersion:RANGE_PROFILE_100Z_SRP.baselineVersion,
        snapshotSha256:RANGE_PROFILE_100Z_SRP.snapshotSha256,
        frequencyModel:RANGE_PROFILE_100Z_SRP.frequencyModel,
        openerPosition:rangeResult.openerPosition,
        defenderPosition:rangeResult.defenderPosition,
        ipPosition:rangeResult.ipPosition,
        oopPosition:rangeResult.oopPosition,
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
        board:[...node.board],
        potBB:node.potBB,
        startingStackBB:node.startingStackBB,
        effectiveStackBB:node.effectiveStackBB,
      },
      outputFile:filename,
      commandText:`${lines.join('\n')}\n`,
      provenance:{
        solverFamily:'TexasSolver-external-export',
        builderVersion:'cash-pro-lab-texassolver-job-v1',
        note:'This file describes an external offline solve job. The job builder does not execute TexasSolver and does not certify the resulting artifact by itself.',
      },
    },
  };
}
