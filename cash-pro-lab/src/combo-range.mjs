import {allTwoCardCombos,assertUniqueCards,splitCombo,canonicalCombo} from './cards.mjs';
import {expandHandClass,normalizeHandClass} from './hand-classes.mjs';

const clamp01=x=>Math.max(0,Math.min(1,Number(x)));

function rangeShell({weights,origins=new Map(),source,status,depthBb,position,node,version='combo-range-v0.3'}){
  return {
    version,
    source,status,depthBb,position,node,
    decisionCertified:status==='certified' && Boolean(source) && depthBb!=null && Boolean(position) && Boolean(node),
    weights,
    origins,
    deadCards:[]
  };
}

export function createComboRange({
  entries=[],
  source='synthetic-lab',
  status='reference-only',
  depthBb=null,
  position=null,
  node=null
}={}){
  const weights=new Map();
  const origins=new Map();
  for(const entry of entries){
    const hc=normalizeHandClass(entry.handClass);
    const w=clamp01(entry.weight ?? 1);
    for(const combo of expandHandClass(hc)){
      if(weights.has(combo)) throw new Error(`overlapping_range_entries:${combo}:${origins.get(combo)}:${hc}`);
      weights.set(combo,w);
      origins.set(combo,hc);
    }
  }
  return rangeShell({weights,origins,source,status,depthBb,position,node});
}

export function createExplicitComboRange({
  combos=[],source='explicit-lab-fixture',status='lab-only',depthBb=null,position=null,node=null
}={}){
  const weights=new Map(),origins=new Map();
  for(const row of combos){
    const raw=String(row.combo||'').trim();
    if(raw.length!==4) throw new Error(`invalid_combo:${raw}`);
    const combo=canonicalCombo(raw.slice(0,2),raw.slice(2,4));
    if(weights.has(combo)) throw new Error(`duplicate_explicit_combo:${combo}`);
    const weight=clamp01(row.weight??1);
    if(weight<=0) continue;
    weights.set(combo,weight);
    origins.set(combo,row.origin||'explicit');
  }
  return rangeShell({weights,origins,source,status,depthBb,position,node});
}

export function fullDeckRange(meta={}){
  const weights=new Map(allTwoCardCombos().map(c=>[c,1]));
  return rangeShell({weights,origins:new Map(),source:'all-combos',status:'lab-only',depthBb:null,position:null,node:null,...meta});
}

export function cloneRange(range){
  return {...range,weights:new Map(range.weights),origins:new Map(range.origins||[]),deadCards:[...(range.deadCards||[])]};
}

export function removeDeadCards(range,cards=[]){
  const dead=assertUniqueCards(cards);
  const deadSet=new Set(dead);
  const next=cloneRange(range);
  for(const combo of [...next.weights.keys()]){
    const [a,b]=splitCombo(combo);
    if(deadSet.has(a)||deadSet.has(b)){
      next.weights.delete(combo);
      next.origins.delete(combo);
    }
  }
  next.deadCards=dead;
  return next;
}

export function effectiveComboCount(range){
  let total=0;
  for(const w of range.weights.values()) total+=Number(w)||0;
  return total;
}

export function physicalComboCount(range){ return range.weights.size; }

export function normalizedComboProbabilities(range){
  const total=effectiveComboCount(range);
  if(total<=0) return new Map();
  return new Map([...range.weights].map(([combo,w])=>[combo,w/total]));
}

export function reweightRange(range,fn,{floor=0,ceiling=1}={}){
  const next=cloneRange(range);
  for(const [combo,w] of next.weights){
    const factor=Number(fn({combo,weight:w,origin:next.origins.get(combo)}));
    const nw=Math.max(floor,Math.min(ceiling,w*(Number.isFinite(factor)?factor:1)));
    if(nw<=0){next.weights.delete(combo);next.origins.delete(combo);} else next.weights.set(combo,nw);
  }
  return next;
}

export function rangeAudit(range){
  const probs=normalizedComboProbabilities(range);
  let probabilitySum=0; for(const p of probs.values()) probabilitySum+=p;
  return {
    version:range.version,
    source:range.source,
    status:range.status,
    decisionCertified:Boolean(range.decisionCertified),
    physicalCombos:physicalComboCount(range),
    effectiveCombos:effectiveComboCount(range),
    probabilitySum,
    deadCards:[...(range.deadCards||[])],
    context:{depthBb:range.depthBb??null,position:range.position??null,node:range.node??null}
  };
}
