const finite=v=>typeof v==='number'&&Number.isFinite(v);

function normalizeMatchup(key,row={}){
  const openSizeBB=Number(row.openSizeBB);
  const potBB=Number(row.potBB);
  const effectiveStackBB=Number(row.effectiveStackBB);
  const sourceRef=String(row.sourceRef||'').trim();
  const errors=[];
  if(!finite(openSizeBB)||openSizeBB<=1)errors.push('open_size_invalid');
  if(!finite(potBB)||potBB<=0)errors.push('pot_invalid');
  if(!finite(effectiveStackBB)||effectiveStackBB<=0)errors.push('effective_stack_invalid');
  if(!sourceRef)errors.push('source_ref_missing');
  const [openerPosition,defenderPosition]=String(key).split(':');
  if(!openerPosition||!defenderPosition||openerPosition===defenderPosition)errors.push('matchup_key_invalid');
  return{key:String(key),openerPosition,defenderPosition,openSizeBB,potBB,effectiveStackBB,sourceRef,errors};
}

export function createPreflopModelProfile(input={}){
  const profileId=String(input.profileId||'').trim();
  const profileVersion=String(input.profileVersion||'').trim();
  const startingStackBB=Number(input.startingStackBB);
  const errors=[];
  if(!profileId)errors.push('profile_id_missing');
  if(!profileVersion)errors.push('profile_version_missing');
  if(!finite(startingStackBB)||startingStackBB<=0)errors.push('starting_stack_invalid');
  const matchups={};
  for(const [key,row] of Object.entries(input.matchups||{})){
    const normalized=normalizeMatchup(key,row);
    if(normalized.errors.length){
      for(const reason of normalized.errors)errors.push(`${key}:${reason}`);
      continue;
    }
    if(normalized.effectiveStackBB>startingStackBB+1e-9)errors.push(`${key}:effective_exceeds_starting`);
    matchups[key]=Object.freeze({...normalized,errors:undefined});
  }
  if(!Object.keys(matchups).length)errors.push('matchups_missing');
  if(errors.length)return{ok:false,errors:[...new Set(errors)],profile:null};
  return{
    ok:true,errors:[],profile:Object.freeze({
      version:'cash-pro-lab-preflop-model-v1',profileId,profileVersion,startingStackBB,
      description:String(input.description||''),
      matchups:Object.freeze(matchups),
    }),
  };
}

export function preflopModelKey(profile={}){
  return `${profile.profileId||'unknown'}@${profile.profileVersion||'unknown'}`;
}

export function resolvePreflopMatchup(profile={},openerPosition,defenderPosition){
  const key=`${String(openerPosition||'').toUpperCase()}:${String(defenderPosition||'').toUpperCase()}`;
  return profile?.matchups?.[key]||null;
}
