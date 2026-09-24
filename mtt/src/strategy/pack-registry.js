import {normalizeHandClass} from '../core/hand-class.js';
import {assertPackMeta} from './pack-schema.js';
import {coversEffectiveBB,depthDistance,normalizeDepthMeta} from './depth-router.js';
import {contextPolicyMatches} from './pack-context.js';

const packs=new Map();
const baseKey=x=>[x.game||'NLHE',x.format||'MTT',x.mode||'cEV',x.tableSize,x.node,x.heroPosition,x.villainPosition||'*'].join('|');
const keyOf=x=>{
 const d=normalizeDepthMeta(x)||{anchor:x.stackDepthBB,min:x.minEffectiveBB??x.stackDepthBB,max:x.maxEffectiveBB??x.stackDepthBB};
 const ctx=x.contextPolicy==='exact-preflop-forced'?JSON.stringify(x.preflopContext):String(x.contextPolicy||'generic');
 return[baseKey(x),d.anchor,d.min,d.max,x.depthPolicy||'exact',ctx].join('|');
};
const certRank={audited:4,'solver-verified':3,'solver-derived':2,'reference-only':1};

export function registerPack(meta,chart){
 assertPackMeta(meta);
 const key=keyOf(meta),normalized={};
 for(const [hand,dist] of Object.entries(chart||{})){
  const h=normalizeHandClass(hand);if(!h)continue;
  const clean={};for(const [action,weight] of Object.entries(dist||{})){const w=Number(weight);if(Number.isFinite(w)&&w>0)clean[String(action).toUpperCase()]=w}
  if(Object.keys(clean).length)normalized[h]=Object.freeze(clean);
 }
 if(!Object.keys(normalized).length)throw new Error('strategy_pack_empty_chart');
 packs.set(key,{meta:Object.freeze({...meta,key}),chart:Object.freeze(normalized)});return key;
}

function baseMatches(meta,query){
 if((meta.game||'NLHE')!==(query.game||'NLHE'))return false;
 if((meta.format||'MTT')!==(query.format||'MTT'))return false;
 if((meta.mode||'cEV')!==(query.mode||'cEV'))return false;
 if(Number(meta.tableSize)!==Number(query.tableSize))return false;
 if(meta.node!==query.node||meta.heroPosition!==query.heroPosition)return false;
 const qv=query.villainPosition||'*';
 if(!((meta.villainPosition||'*')==='*'||(meta.villainPosition||'*')===qv))return false;
 return contextPolicyMatches(meta,query);
}

export function candidatePacks(query={}){
 const effectiveBB=Number(query.effectiveBB??query.stackDepthBB);
 if(!Number.isFinite(effectiveBB)||effectiveBB<=0)return[];
 return[...packs.values()].filter(p=>baseMatches(p.meta,query)&&coversEffectiveBB(p.meta,effectiveBB)).sort((a,b)=>{
  const qv=query.villainPosition||'*';
  const ax=(a.meta.villainPosition||'*')===qv?1:0,bx=(b.meta.villainPosition||'*')===qv?1:0;
  if(bx!==ax)return bx-ax;
  const ctxA=a.meta.contextPolicy==='exact-preflop-forced'?1:0,ctxB=b.meta.contextPolicy==='exact-preflop-forced'?1:0;if(ctxB!==ctxA)return ctxB-ctxA;
  const dd=depthDistance(a.meta,effectiveBB)-depthDistance(b.meta,effectiveBB);if(dd)return dd;
  const cr=(certRank[b.meta.certification]||0)-(certRank[a.meta.certification]||0);if(cr)return cr;
  const ad=normalizeDepthMeta(a.meta),bd=normalizeDepthMeta(b.meta);
  return(ad.max-ad.min)-(bd.max-bd.min);
 });
}

export function getPack(query){return candidatePacks(query)[0]||null}
export function lookupDistribution(query,hand){const p=getPack(query),h=normalizeHandClass(hand);return p&&h?{pack:p.meta,distribution:p.chart[h]||null}:null}
export function clearPacks(){packs.clear()}
export function registeredPackCount(){return packs.size}
export function listRegisteredPacks(){return [...packs.values()].map(p=>p.meta)}
export function registeredPackKeys(){return [...packs.keys()]}
