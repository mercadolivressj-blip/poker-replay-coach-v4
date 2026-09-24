import {positionsFor} from '../core/positions.js';
import {MTT_STACK_DEPTHS} from './depth-router.js';
import {candidatePacks} from './pack-registry.js';

export function buildCoverageTargets({tableSizes=[8,9],depths=MTT_STACK_DEPTHS,nodes=['unopened','vs_open','vs_3bet','vs_4bet_plus','reshove'],modes=['cEV']}={}){
 const out=[];
 for(const tableSize of tableSizes){
  for(const heroPosition of positionsFor(tableSize)){
   for(const effectiveBB of depths){
    for(const node of nodes){
     for(const mode of modes){
      out.push({game:'NLHE',format:'MTT',mode,tableSize,effectiveBB,node,heroPosition,villainPosition:'*'});
     }
    }
   }
  }
 }
 return out;
}

export function auditRegisteredCoverage(targets=buildCoverageTargets()){
 const rows=targets.map(target=>{
  const candidates=candidatePacks(target);
  const pack=candidates[0]?.meta||null;
  return{target,covered:Boolean(pack),pack};
 });
 const covered=rows.filter(x=>x.covered).length,total=rows.length,missing=total-covered;
 const aggregate=(field)=>{
  const m={};
  for(const row of rows){
   const key=String(row.target[field]);
   const x=m[key]||(m[key]={total:0,covered:0,missing:0});
   x.total++;if(row.covered)x.covered++;else x.missing++;
  }
  for(const x of Object.values(m))x.coveragePct=x.total?x.covered/x.total*100:0;
  return m;
 };
 return{
  total,covered,missing,coveragePct:total?covered/total*100:0,
  byDepth:aggregate('effectiveBB'),
  byNode:aggregate('node'),
  byPosition:aggregate('heroPosition'),
  rows
 };
}

export function missingCoverageTargets(targets){return auditRegisteredCoverage(targets).rows.filter(x=>!x.covered).map(x=>x.target)}
