import fs from 'node:fs';
import path from 'node:path';
import { executeHighRakeJob, validateHighRakeManifest } from './lib/cash-pro-lab-highrake-runner.mjs';

function arg(name,fallback=null){const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]!=null?process.argv[i+1]:fallback;}
const has=name=>process.argv.includes(name);
const manifestPath=path.resolve(arg('--manifest','cash-pro-lab-highrake-campaign/manifest.json'));
const solverArg=arg('--solver',null);
const proofArg=arg('--proof',null);
const split=arg('--split',null);
const maxRaw=arg('--max',null);
const max=maxRaw==null?Infinity:Number(maxRaw);
const dryRun=has('--dry-run'),resume=has('--resume');
if(!solverArg) throw new Error('--solver <local compiled solver binary> is required; this runner never downloads or builds third-party code');
if(!dryRun&&!proofArg) throw new Error('--proof <local solution-proof binary> is required for bounded-memory production validation');
if(split&&!['train','dev','holdout'].includes(split)) throw new Error(`invalid --split ${split}`);
if(max!==Infinity&&(!Number.isInteger(max)||max<1)) throw new Error(`invalid --max ${maxRaw}`);
if(!fs.existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const checked=validateHighRakeManifest(manifest);
if(!checked.ok) throw new Error(`invalid high-rake manifest: ${checked.errors.join(', ')}`);
let jobs=manifest.jobs.filter(row=>!split||row.split===split);
if(max!==Infinity) jobs=jobs.slice(0,max);
const manifestDir=path.dirname(manifestPath),solverPath=path.resolve(solverArg),proofPath=proofArg?path.resolve(proofArg):null;
const summary={
  version:'cash-pro-lab-highrake-run-summary-v2',campaignId:manifest.campaignId,manifestPath,solverPath,proofPath,
  split:split||'all',dryRun,resume,requestedJobs:jobs.length,counts:{},rows:[],startedAt:new Date().toISOString(),
  validatedStrategyOracleRoots:0,alternativeEvOracleRoots:0,certifiedStudies:0,
};
for(const [i,row] of jobs.entries()){
  const result=await executeHighRakeJob({manifestDir,row,solverPath,proofPath,dryRun,resume});
  summary.rows.push(result);summary.counts[result.status]=(summary.counts[result.status]||0)+1;
  if(['VALIDATED_STRATEGY_ORACLE','RESUMED_VALIDATED_STRATEGY_ORACLE'].includes(result.status)) summary.validatedStrategyOracleRoots++;
  console.log(`[${i+1}/${jobs.length}] ${row.id} -> ${result.status}${result.reason?` (${result.reason})`:''}`);
}
summary.finishedAt=new Date().toISOString();
summary.note='Strategy-oracle validation uses bounded-memory structure proof, raked NashConv convergence and gzip-archive integrity. Alternative-EV authority and required independent-teacher consensus remain separate gates.';
const runsDir=path.join(manifestDir,'runs');fs.mkdirSync(runsDir,{recursive:true});
const summaryPath=path.join(runsDir,`highrake-${summary.startedAt.replace(/[:.]/g,'-')}.json`);
fs.writeFileSync(summaryPath,JSON.stringify(summary,null,2));
console.log(JSON.stringify({ok:true,summaryPath,counts:summary.counts,validatedStrategyOracleRoots:summary.validatedStrategyOracleRoots,alternativeEvOracleRoots:0,certifiedStudies:0},null,2));
if((summary.counts.FAILED||0)+(summary.counts.BLOCKED||0)>0) process.exitCode=2;
