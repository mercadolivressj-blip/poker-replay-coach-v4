// Replay/post-game identity only. No process/memory inspection and no fuzzy guessing.
// Exact visible screen-name identity is deliberately conservative: ambiguous or missing names do not inherit profiles.

function normalizeVisibleName(name){
  const s=String(name??'').normalize('NFKC').trim().replace(/\s+/g,' ');
  return s || null;
}

function fnv1a32(text){
  let h=0x811c9dc5;
  for(const ch of String(text)){
    h^=ch.codePointAt(0);
    h=Math.imul(h,0x01000193)>>>0;
  }
  return h.toString(16).padStart(8,'0');
}

export function playerIdentityFromVisibleName(name,{site='pokerstars',confidence=1}={}){
  const visible=normalizeVisibleName(name);
  const c=Math.max(0,Math.min(1,Number(confidence)||0));
  if(!visible || c<0.99){
    return {resolved:false,playerId:null,visibleName:visible,site,confidence:c,reason:!visible?'name_missing':'identity_not_exact'};
  }
  const canonical=visible.toLocaleLowerCase('en-US');
  return {resolved:true,playerId:`${site}:${fnv1a32(canonical)}`,visibleName:visible,canonical,site,confidence:c,reason:null};
}

export function unresolvedIdentity(reason='unknown'){
  return {resolved:false,playerId:null,visibleName:null,site:null,confidence:0,reason};
}

export function sameIdentity(a,b){
  return Boolean(a?.resolved && b?.resolved && a.playerId===b.playerId);
}
