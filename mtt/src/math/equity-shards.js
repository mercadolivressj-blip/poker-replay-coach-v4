import {all169,normalizeHandClass} from '../core/hand-class.js';
import {equityClassVsClass} from './class-equity.js';
import {buildEquityMatrixSnapshot} from './equity-matrix-snapshot.js';

function canonicalHands(hands=all169()){
 const hs=[...new Set(hands.map(normalizeHandClass).filter(Boolean))].sort();
 if(!hs.length)throw new Error('equity_shards_hands_empty');return hs;
}

export function equityPairPlan(hands=all169()){
 const hs=canonicalHands(hands),pairs=[];
 for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++)pairs.push({index:pairs.length,a:hs[i],b:hs[j]});
 return{hands:hs,pairs,totalPairs:pairs.length};
}

export function shardPairPlan({hands=all169(),shardCount=1,shardIndex=0}={}){
 const count=Math.floor(Number(shardCount)),index=Math.floor(Number(shardIndex));
 if(!(count>=1)||index<0||index>=count)throw new Error('equity_shard_index_invalid');
 const plan=equityPairPlan(hands),pairs=plan.pairs.filter(p=>p.index%count===index);
 return{schema:'ssj-mtt-equity-shard-plan-v1',hands:plan.hands,shardCount:count,shardIndex:index,totalPairs:plan.totalPairs,pairs};
}

export function buildEquityShard({hands=all169(),shardCount=1,shardIndex=0,iterationsPerPair=20000,seed='ssj-mtt-equity-prod-a'}={}){
 const plan=shardPairPlan({hands,shardCount,shardIndex}),iterations=Math.floor(Number(iterationsPerPair));
 if(!(iterations>0))throw new Error('equity_shard_iterations_invalid');
 const rows=[];
 for(const p of plan.pairs){
  const r=equityClassVsClass(p.a,p.b,{iterations,seed});
  rows.push({index:p.index,a:p.a,b:p.b,equity:r.equity,total:r.total,compatiblePairs:r.compatiblePairs});
 }
 return{schema:'ssj-mtt-equity-shard-v1',hands:plan.hands,shardCount:plan.shardCount,shardIndex:plan.shardIndex,totalPairs:plan.totalPairs,iterationsPerPair:iterations,seed:String(seed),rows};
}

export function mergeEquityShards(shards=[],{evaluatorVersion='fast-holdem-evaluator-v1'}={}){
 if(!Array.isArray(shards)||!shards.length)throw new Error('equity_shards_missing');
 const first=shards[0],hs=canonicalHands(first.hands),count=Number(first.shardCount),totalPairs=Number(first.totalPairs),iterations=Number(first.iterationsPerPair),seed=String(first.seed);
 const seenShards=new Set(),byIndex=new Map();
 for(const s of shards){
  if(s.schema!=='ssj-mtt-equity-shard-v1')throw new Error('equity_shard_schema_invalid');
  if(JSON.stringify(canonicalHands(s.hands))!==JSON.stringify(hs))throw new Error('equity_shard_hands_mismatch');
  if(Number(s.shardCount)!==count||Number(s.totalPairs)!==totalPairs||Number(s.iterationsPerPair)!==iterations||String(s.seed)!==seed)throw new Error('equity_shard_metadata_mismatch');
  const si=Number(s.shardIndex);if(seenShards.has(si))throw new Error(`equity_shard_duplicate:${si}`);seenShards.add(si);
  for(const row of s.rows||[]){
   const idx=Number(row.index),e=Number(row.equity);if(!Number.isInteger(idx)||idx<0||idx>=totalPairs||!Number.isFinite(e)||e<0||e>1)throw new Error('equity_shard_row_invalid');
   if(byIndex.has(idx))throw new Error(`equity_pair_duplicate:${idx}`);byIndex.set(idx,{...row,equity:e});
  }
 }
 if(seenShards.size!==count)throw new Error(`equity_shards_incomplete:${seenShards.size}/${count}`);
 if(byIndex.size!==totalPairs)throw new Error(`equity_pairs_incomplete:${byIndex.size}/${totalPairs}`);
 const expected=equityPairPlan(hs),matrix={};for(const h of hs){matrix[h]={};matrix[h][h]=.5}
 for(const p of expected.pairs){const row=byIndex.get(p.index);if(!row||row.a!==p.a||row.b!==p.b)throw new Error(`equity_pair_identity_mismatch:${p.index}`);matrix[p.a][p.b]=row.equity;matrix[p.b][p.a]=1-row.equity}
 const snapshot=buildEquityMatrixSnapshot({matrix,hands:hs,seed,iterationsPerPair:iterations,evaluatorVersion});
 return{snapshot,merge:{shards:seenShards.size,totalPairs:byIndex.size,complete:true}};
}
