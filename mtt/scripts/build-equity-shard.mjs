import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {all169,normalizeHandClass} from '../src/core/hand-class.js';
import {buildEquityShard} from '../src/math/equity-shards.js';

function arg(name,def=null){const prefix=`--${name}=`;const hit=process.argv.slice(2).find(x=>x.startsWith(prefix));return hit?hit.slice(prefix.length):def}
const shardCount=Number(arg('shard-count','16')),shardIndex=Number(arg('shard-index','0')),iterationsPerPair=Number(arg('iterations','20000')),seed=arg('seed','ssj-mtt-equity-prod-a');
const rawHands=arg('hands','all'),hands=rawHands==='all'?all169():rawHands.split(',').map(normalizeHandClass).filter(Boolean);
const out=resolve(arg('out',`artifacts/equity-shard-${shardIndex}-of-${shardCount}.json`));
const shard=buildEquityShard({hands,shardCount,shardIndex,iterationsPerPair,seed});
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(shard,null,2)+'\n','utf8');
console.log(JSON.stringify({event:'equity_shard_done',shardIndex,shardCount,rows:shard.rows.length,iterationsPerPair,seed,out}));
