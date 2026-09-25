import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {mergeEquityShards} from '../src/math/equity-shards.js';

function arg(name,def=null){const prefix=`--${name}=`;const hit=process.argv.slice(2).find(x=>x.startsWith(prefix));return hit?hit.slice(prefix.length):def}
const inputs=String(arg('inputs','')).split(',').map(x=>x.trim()).filter(Boolean);
if(!inputs.length)throw new Error('merge_requires_inputs');
const out=resolve(arg('out','artifacts/equity-matrix-snapshot.json'));
const shards=inputs.map(p=>JSON.parse(readFileSync(resolve(p),'utf8')));
const merged=mergeEquityShards(shards);
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(merged.snapshot,null,2)+'\n','utf8');
console.log(JSON.stringify({event:'equity_shards_merged',inputs:inputs.length,sha256:merged.snapshot.sha256,hands:merged.snapshot.hands.length,totalPairs:merged.merge.totalPairs,out}));
