import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {solveAndBuildVerifiedPushFoldSuite} from '../src/strategy/pushfold-suite-builder.js';

function arg(name,def=null){const prefix=`--${name}=`;const hit=process.argv.slice(2).find(x=>x.startsWith(prefix));return hit?hit.slice(prefix.length):def}
const snapshotPath=resolve(arg('snapshot','artifacts/equity-snapshot-a.json'));
const auditPath=resolve(arg('audit','artifacts/equity-stability-audit.json'));
const contextPath=resolve(arg('context','artifacts/preflop-context.json'));
const out=resolve(arg('out','artifacts/pushfold-suite.json'));
const depths=String(arg('depths','8,10,12,15')).split(',').map(Number).filter(x=>Number.isFinite(x)&&x>0);
const solverOptions={
 regretIterations:Number(arg('regret-iterations','16000')),
 burnIn:Number(arg('burn-in','2000')),
 fictitiousIterations:Number(arg('fictitious-iterations','12000')),
 maxNashConv:Number(arg('max-nash-conv','.02')),
 maxMeanFrequencyDiff:Number(arg('max-mean-frequency-diff','.04')),
 maxFrequencyDiff:Number(arg('max-frequency-diff','.15'))
};
const snapshot=JSON.parse(readFileSync(snapshotPath,'utf8'));
const audit=JSON.parse(readFileSync(auditPath,'utf8'));
const preflopContext=JSON.parse(readFileSync(contextPath,'utf8'));
console.log(JSON.stringify({event:'pushfold_suite_start',snapshotSha256:snapshot.sha256,depths,tableSize:preflopContext.playersDealt,solverOptions}));
const suite=solveAndBuildVerifiedPushFoldSuite({snapshot,audit,preflopContext,depths,solverOptions});
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(suite,null,2)+'\n','utf8');
console.log(JSON.stringify({event:'pushfold_suite_done',certification:suite.certification,snapshotSha256:suite.snapshotSha256,depths:suite.depths,packs:suite.packs.length,out}));
