import fs from 'node:fs';
import path from 'node:path';
import { executeExternalSolverJob, validateExternalSolverManifest } from './lib/cash-pro-lab-external-solver.mjs';

function valueArg(name,fallback=null){
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]!=null?process.argv[i+1]:fallback;
}
function has(name){return process.argv.includes(name);}

const manifestPath=path.resolve(valueArg('--manifest','cash-pro-lab-solver-campaign/manifest.json'));
const solverArg=valueArg('--solver',null);
const split=valueArg('--split',null);
const maxRaw=valueArg('--max',null);
const max=maxRaw==null?Infinity:Number(maxRaw);
const dryRun=has('--dry-run');
const resume=has('--resume');

if(!solverArg) throw new Error('--solver <local console_solver path> is required; this runner never downloads or bundles a solver binary');
if(split&&!['train','dev','holdout'].includes(split)) throw new Error(`invalid --split ${split}`);
if(!Number.isFinite(max)&&max!==Infinity) throw new Error(`invalid --max ${maxRaw}`);
if(max!==Infinity&&(!Number.isInteger(max)||max<1)) throw new Error(`invalid --max ${maxRaw}`);
if(!fs.existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);

const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const checked=validateExternalSolverManifest(manifest);
if(!checked.ok) throw new Error(`invalid manifest: ${checked.errors.join(', ')}`);
const manifestDir=path.dirname(manifestPath);
const solverPath=path.resolve(solverArg);
let jobs=manifest.jobs.filter(job=>!split||job.split===split);
if(max!==Infinity) jobs=jobs.slice(0,max);

const summary={
  version:'cash-pro-lab-external-solver-run-summary-v1',
  campaignId:manifest.campaign.campaignId,
  manifestPath,
  solverPath,
  split:split||'all',
  dryRun,
  resume,
  requestedJobs:jobs.length,
  counts:{},
  rows:[],
  startedAt:new Date().toISOString(),
};

for(const [index,job] of jobs.entries()){
  const row=await executeExternalSolverJob({manifestDir,job,solverPath,dryRun,resume});
  summary.rows.push(row);
  summary.counts[row.status]=(summary.counts[row.status]||0)+1;
  console.log(`[${index+1}/${jobs.length}] ${job.id} -> ${row.status}${row.reason?` (${row.reason})`:''}`);
  if(row.status==='FAILED'||row.status==='BLOCKED'){
    console.error(JSON.stringify(row));
  }
}
summary.finishedAt=new Date().toISOString();
summary.certifiedStudies=0;
summary.note='RAW_SOLVER_ARTIFACT is intentionally not a certified study. Semantic validation, exact-node extraction, teacher independence and EV audit are separate gates.';
const runDir=path.join(manifestDir,'runs');
fs.mkdirSync(runDir,{recursive:true});
const stamp=summary.startedAt.replace(/[:.]/g,'-');
const summaryPath=path.join(runDir,`run-${stamp}.json`);
fs.writeFileSync(summaryPath,JSON.stringify(summary,null,2));
console.log(JSON.stringify({ok:true,summaryPath,counts:summary.counts,certifiedStudies:0},null,2));

if((summary.counts.FAILED||0)+(summary.counts.BLOCKED||0)>0) process.exitCode=2;
