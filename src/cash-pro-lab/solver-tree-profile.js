const STREETS=['flop','turn','river'];
const POSITIONS=['oop','ip'];
const KINDS=['bet','raise','donk'];
const finite=v=>typeof v==='number'&&Number.isFinite(v);

function cleanSizes(values=[]){
  if(!Array.isArray(values)) return null;
  const out=values.map(Number);
  if(out.some(v=>!finite(v)||v<=0)) return null;
  return [...new Set(out)];
}

export function createSolverTreeProfile(input={}){
  const errors=[];
  const profileId=String(input.profileId||'').trim();
  const profileVersion=String(input.profileVersion||'').trim();
  if(!profileId) errors.push('profile_id_missing');
  if(!profileVersion) errors.push('profile_version_missing');
  const actions=[];
  const tree=input.tree&&typeof input.tree==='object'?input.tree:{};

  for(const position of POSITIONS){
    for(const street of STREETS){
      const row=tree?.[position]?.[street];
      if(!row) continue;
      for(const kind of KINDS){
        if(row[kind]==null) continue;
        const sizes=cleanSizes(row[kind]);
        if(!sizes) errors.push(`invalid_sizes:${position}:${street}:${kind}`);
        else if(sizes.length) actions.push({position,street,kind,sizes});
      }
      if(row.allin===true) actions.push({position,street,kind:'allin',sizes:[]});
      else if(row.allin!=null&&row.allin!==false) errors.push(`invalid_allin_flag:${position}:${street}`);
    }
  }
  if(!actions.length) errors.push('tree_actions_missing');

  const allinThreshold=Number(input.allinThreshold);
  if(!finite(allinThreshold)||allinThreshold<=0||allinThreshold>1) errors.push('allin_threshold_invalid');

  const compute=input.compute&&typeof input.compute==='object'?input.compute:{};
  const threadNum=Number(compute.threadNum);
  const accuracy=Number(compute.accuracy);
  const maxIteration=Number(compute.maxIteration);
  const printInterval=Number(compute.printInterval);
  const dumpRounds=Number(compute.dumpRounds);
  const useIsomorphism=compute.useIsomorphism===true||compute.useIsomorphism===1?1:compute.useIsomorphism===false||compute.useIsomorphism===0?0:null;
  if(!Number.isInteger(threadNum)||threadNum<1) errors.push('thread_num_invalid');
  if(!finite(accuracy)||accuracy<=0) errors.push('accuracy_invalid');
  if(!Number.isInteger(maxIteration)||maxIteration<1) errors.push('max_iteration_invalid');
  if(!Number.isInteger(printInterval)||printInterval<1) errors.push('print_interval_invalid');
  if(!Number.isInteger(dumpRounds)||dumpRounds<1) errors.push('dump_rounds_invalid');
  if(useIsomorphism==null) errors.push('isomorphism_flag_invalid');

  if(errors.length) return {ok:false,errors:[...new Set(errors)],profile:null};
  return {
    ok:true,
    errors:[],
    profile:Object.freeze({
      version:'cash-pro-lab-solver-tree-profile-v1',
      profileId,
      profileVersion,
      description:String(input.description||''),
      actions:Object.freeze(actions.map(a=>Object.freeze({...a,sizes:Object.freeze([...a.sizes])}))),
      allinThreshold,
      compute:Object.freeze({threadNum,accuracy,maxIteration,printInterval,dumpRounds,useIsomorphism}),
    }),
  };
}

export function treeProfileKey(profile={}){
  return `${profile.profileId||'unknown'}@${profile.profileVersion||'unknown'}`;
}
