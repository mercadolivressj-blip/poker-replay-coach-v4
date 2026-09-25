const GROUPS=['NUTS','STRONG_VALUE','MEDIUM_SHOWDOWN','DRAW_MISSED','BLUFF_CANDIDATE','AIR'];

const ACTION_LIKELIHOODS=Object.freeze({
  flop:Object.freeze({
    check:{NUTS:.45,STRONG_VALUE:.58,MEDIUM_SHOWDOWN:.82,DRAW_MISSED:.68,BLUFF_CANDIDATE:.64,AIR:.72},
    small_bet:{NUTS:.75,STRONG_VALUE:.82,MEDIUM_SHOWDOWN:.63,DRAW_MISSED:.78,BLUFF_CANDIDATE:.76,AIR:.52},
    medium_bet:{NUTS:.84,STRONG_VALUE:.86,MEDIUM_SHOWDOWN:.49,DRAW_MISSED:.76,BLUFF_CANDIDATE:.67,AIR:.35},
    large_bet:{NUTS:.92,STRONG_VALUE:.78,MEDIUM_SHOWDOWN:.28,DRAW_MISSED:.63,BLUFF_CANDIDATE:.69,AIR:.20},
    raise:{NUTS:.96,STRONG_VALUE:.84,MEDIUM_SHOWDOWN:.18,DRAW_MISSED:.55,BLUFF_CANDIDATE:.72,AIR:.12}
  }),
  turn:Object.freeze({
    check:{NUTS:.42,STRONG_VALUE:.55,MEDIUM_SHOWDOWN:.85,DRAW_MISSED:.72,BLUFF_CANDIDATE:.62,AIR:.68},
    small_bet:{NUTS:.72,STRONG_VALUE:.80,MEDIUM_SHOWDOWN:.55,DRAW_MISSED:.71,BLUFF_CANDIDATE:.73,AIR:.43},
    medium_bet:{NUTS:.86,STRONG_VALUE:.82,MEDIUM_SHOWDOWN:.38,DRAW_MISSED:.66,BLUFF_CANDIDATE:.70,AIR:.29},
    large_bet:{NUTS:.95,STRONG_VALUE:.75,MEDIUM_SHOWDOWN:.20,DRAW_MISSED:.55,BLUFF_CANDIDATE:.74,AIR:.14},
    raise:{NUTS:.98,STRONG_VALUE:.80,MEDIUM_SHOWDOWN:.12,DRAW_MISSED:.48,BLUFF_CANDIDATE:.71,AIR:.08}
  }),
  river:Object.freeze({
    check:{NUTS:.25,STRONG_VALUE:.48,MEDIUM_SHOWDOWN:.92,DRAW_MISSED:.88,BLUFF_CANDIDATE:.70,AIR:.84},
    small_bet:{NUTS:.66,STRONG_VALUE:.86,MEDIUM_SHOWDOWN:.62,DRAW_MISSED:.22,BLUFF_CANDIDATE:.58,AIR:.18},
    medium_bet:{NUTS:.82,STRONG_VALUE:.83,MEDIUM_SHOWDOWN:.42,DRAW_MISSED:.28,BLUFF_CANDIDATE:.67,AIR:.14},
    large_bet:{NUTS:.97,STRONG_VALUE:.68,MEDIUM_SHOWDOWN:.14,DRAW_MISSED:.42,BLUFF_CANDIDATE:.84,AIR:.08},
    raise:{NUTS:.995,STRONG_VALUE:.61,MEDIUM_SHOWDOWN:.07,DRAW_MISSED:.25,BLUFF_CANDIDATE:.79,AIR:.04}
  })
});

function normalize(weights){
  let total=0; for(const g of GROUPS) total += Math.max(0, Number(weights[g]||0));
  if(total<=0) return Object.fromEntries(GROUPS.map(g=>[g,1/GROUPS.length]));
  return Object.fromEntries(GROUPS.map(g=>[g,Math.max(0,Number(weights[g]||0))/total]));
}

export function createRangeBelief(prior={}){
  const base={NUTS:.06,STRONG_VALUE:.16,MEDIUM_SHOWDOWN:.34,DRAW_MISSED:.16,BLUFF_CANDIDATE:.16,AIR:.12,...prior};
  return {version:'range-belief-v0.1',weights:normalize(base),history:[]};
}

export function sizingBucket(sizePct){
  const x=Number(sizePct);
  if(!Number.isFinite(x)||x<=0) return 'check';
  if(x<=40) return 'small_bet';
  if(x<=75) return 'medium_bet';
  return 'large_bet';
}

export function updateBelief(belief,{street,action,sizePct=null,boardFeatures={}}){
  const s=String(street||'').toLowerCase();
  let key=String(action||'').toLowerCase();
  if(key==='bet') key=sizingBucket(sizePct);
  if(key==='allin'||key==='shove') key='raise';
  const table=ACTION_LIKELIHOODS[s]?.[key];
  if(!table) throw new Error(`unsupported_evidence:${street}:${action}`);
  const next={};
  for(const g of GROUPS) next[g]=belief.weights[g]*table[g];

  // River completion cards reshape plausible value/bluff composition.
  if(s==='river' && boardFeatures.flushCompleted){
    next.NUTS*=1.35; next.STRONG_VALUE*=0.92; next.MEDIUM_SHOWDOWN*=0.72;
    if(key==='large_bet'||key==='raise') next.BLUFF_CANDIDATE*=1.12;
  }
  if(s==='river' && boardFeatures.straightCompleted){
    next.NUTS*=1.22; next.STRONG_VALUE*=0.94; next.MEDIUM_SHOWDOWN*=0.78;
  }
  belief.weights=normalize(next);
  belief.history.push({street:s,action:key,sizePct,boardFeatures:{...boardFeatures}});
  return belief;
}

export function applyHeroBlockers(belief,{blocksNuts=0,blocksStrongValue=0,blocksBluffs=0}={}){
  const f=x=>Math.max(0.05,1-Math.max(0,Math.min(0.95,Number(x)||0)));
  belief.weights.NUTS*=f(blocksNuts);
  belief.weights.STRONG_VALUE*=f(blocksStrongValue);
  belief.weights.BLUFF_CANDIDATE*=f(blocksBluffs);
  belief.weights=normalize(belief.weights);
  return belief;
}

export function rangeSummary(belief){
  const w=belief.weights;
  return {
    ...w,
    value:w.NUTS+w.STRONG_VALUE,
    showdown:w.MEDIUM_SHOWDOWN,
    bluff:w.DRAW_MISSED+w.BLUFF_CANDIDATE+w.AIR,
    polarized:(w.NUTS+w.BLUFF_CANDIDATE)>=0.45 && w.MEDIUM_SHOWDOWN<=0.22
  };
}

export {GROUPS};
