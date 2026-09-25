import {readdirSync,readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {mergeEquityShards} from '../src/math/equity-shards.js';

function arg(name,def=null){const prefix=`--${name}=`;const hit=process.argv.slice(2).find(x=>x.startsWith(prefix));return hit?hit.slice(prefix.length):def}
function jsonFiles(root){const out=[];for(const name of readdirSync(root)){const p=join(root,name),st=statSync(p);if(st.isDirectory())out.push(...jsonFiles(p));else if(name.endsWith('.json'))out.push(p)}return out.sort()}
const inputDir=resolve(arg('dir','artifacts/shards')),out=resolve(arg('out','artifacts/equity-matrix-snapshot.json'));
const files=jsonFiles(inputDir);if(!files.length)throw new Error(`merge_dir_no_json:${inputDir}`);
const shards=files.map(p=>JSON.parse(readFileSync(p,'utf8')));
const merged=mergeEquityShards(shards);
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(merged.snapshot,null,2)+'\n','utf8');
console.log(JSON.stringify({event:'equity_shards_dir_merged',files:files.length,sha256:merged.snapshot.sha256,hands:merged.snapshot.hands.length,totalPairs:merged.merge.totalPairs,out}));
