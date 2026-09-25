import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {all169,normalizeHandClass} from '../src/core/hand-class.js';
import {buildClassEquityMatrix} from '../src/math/class-equity.js';
import {buildEquityMatrixSnapshot} from '../src/math/equity-matrix-snapshot.js';

function arg(name,def=null){
 const prefix=`--${name}=`;const hit=process.argv.slice(2).find(x=>x.startsWith(prefix));return hit?hit.slice(prefix.length):def;
}
const seed=arg('seed','ssj-mtt-equity-prod-a');
const iterationsPerPair=Number(arg('iterations','20000'));
const out=resolve(arg('out','artifacts/equity-matrix-snapshot.json'));
const rawHands=arg('hands','all');
const hands=rawHands==='all'?all169():rawHands.split(',').map(normalizeHandClass).filter(Boolean);
if(!hands.length)throw new Error('no_hands_selected');
if(!(iterationsPerPair>0))throw new Error('iterations_must_be_positive');

console.log(JSON.stringify({event:'equity_snapshot_start',hands:hands.length,iterationsPerPair,seed,out}));
const built=buildClassEquityMatrix({hands,iterationsPerPair,seed});
const snapshot=buildEquityMatrixSnapshot({matrix:built.matrix,hands:built.hands,seed:built.seed,iterationsPerPair:built.iterationsPerPair,evaluatorVersion:'fast-holdem-evaluator-v1'});
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify(snapshot,null,2)+'\n','utf8');
console.log(JSON.stringify({event:'equity_snapshot_done',sha256:snapshot.sha256,hands:snapshot.hands.length,iterationsPerPair:snapshot.iterationsPerPair,out}));
