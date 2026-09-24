import {normalizeHandClass} from '../core/hand-class.js';
import {assertPackMeta} from './pack-schema.js';

const packs=new Map();
const keyOf=x=>[x.game||'NLHE',x.format||'MTT',x.mode||'cEV',x.tableSize,x.stackBucket,x.node,x.heroPosition,x.villainPosition||'*'].join('|');

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

export function getPack(query){return packs.get(keyOf(query))||packs.get(keyOf({...query,villainPosition:'*'}))||null}
export function lookupDistribution(query,hand){const p=getPack(query),h=normalizeHandClass(hand);return p&&h?{pack:p.meta,distribution:p.chart[h]||null}:null}
export function clearPacks(){packs.clear()}
export function registeredPackCount(){return packs.size}
