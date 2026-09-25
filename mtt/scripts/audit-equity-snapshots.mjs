import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {auditEquitySnapshots} from '../src/math/equity-snapshot-audit.js';

function arg(name,def=null){const prefix=`--${name}=`;const hit=process.argv.slice(2).find(x=>x.startsWith(prefix));return hit?hit.slice(prefix.length):def}
const inputs=String(arg('inputs','')).split(',').map(x=>x.trim()).filter(Boolean);
if(inputs.length<2)throw new Error('audit_requires_at_least_two_inputs');
const maxMeanAbsDiff=Number(arg('max-mean-diff','.012')),maxMaxAbsDiff=Number(arg('max-max-diff','.04'));
const out=resolve(arg('out','artifacts/equity-stability-audit.json'));
const snapshots=inputs.map(p=>JSON.parse(readFileSync(resolve(p),'utf8')));
const report=auditEquitySnapshots({snapshots,maxMeanAbsDiff,maxMaxAbsDiff});
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({event:'equity_snapshot_audit_done',stable:report.stable,snapshotShas:report.snapshotShas,seeds:report.seeds,meanPairRange:report.stability.meanPairRange,maxPairRange:report.stability.maxPairRange,maxPair:report.stability.maxPair,out}));
if(!report.stable)process.exitCode=2;
