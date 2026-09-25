import assert from 'node:assert/strict';
import {equityPairPlan,shardPairPlan,buildEquityShard,mergeEquityShards} from '../src/math/equity-shards.js';
import {verifyEquityMatrixSnapshot} from '../src/math/equity-matrix-snapshot.js';

const hands=['AA','KK','72o','A5s'];
const plan=equityPairPlan(hands);
assert.equal(plan.totalPairs,6);
assert.deepEqual(plan.hands,['72o','A5s','AA','KK']);
const p0=shardPairPlan({hands,shardCount:3,shardIndex:0});
const p1=shardPairPlan({hands,shardCount:3,shardIndex:1});
const p2=shardPairPlan({hands,shardCount:3,shardIndex:2});
assert.equal(p0.pairs.length+p1.pairs.length+p2.pairs.length,6);
assert.deepEqual([...p0.pairs,...p1.pairs,...p2.pairs].map(x=>x.index).sort((a,b)=>a-b),[0,1,2,3,4,5]);

const args={hands,shardCount:3,iterationsPerPair:250,seed:'shard-test-seed'};
const s0=buildEquityShard({...args,shardIndex:0});
const s1=buildEquityShard({...args,shardIndex:1});
const s2=buildEquityShard({...args,shardIndex:2});
const merged=mergeEquityShards([s2,s0,s1]);
assert.equal(merged.merge.complete,true);
assert.equal(merged.merge.totalPairs,6);
assert.equal(verifyEquityMatrixSnapshot(merged.snapshot).valid,true);
assert.equal(merged.snapshot.hands.length,4);
for(const h of merged.snapshot.hands)assert.equal(merged.snapshot.matrix[h][h],.5);
for(let i=0;i<merged.snapshot.hands.length;i++)for(let j=i+1;j<merged.snapshot.hands.length;j++){
 const a=merged.snapshot.hands[i],b=merged.snapshot.hands[j];
 assert(Math.abs(merged.snapshot.matrix[a][b]+merged.snapshot.matrix[b][a]-1)<1e-12);
}
assert.throws(()=>mergeEquityShards([s0,s1]),/shards_incomplete/);
assert.throws(()=>mergeEquityShards([s0,s0,s1,s2]),/shard_duplicate/);
const wrong=structuredClone(s2);wrong.seed='different';
assert.throws(()=>mergeEquityShards([s0,s1,wrong]),/metadata_mismatch/);

console.log('PASS — deterministic sharded equity generation / merge / completeness regressions');
