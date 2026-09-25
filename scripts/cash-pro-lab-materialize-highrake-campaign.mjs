import fs from 'node:fs';
import path from 'node:path';
import { materializeCurrentHighRakeCampaign } from '../src/cash-pro-lab/highrake-solve-campaign-materializer.js';

function arg(name,fallback=null){const i=process.argv.indexOf(name);return i>=0&&process.argv[i+1]!=null?process.argv[i+1]:fallback;}
function optionalNumber(name,{integer=false,min=null}={}){
  const raw=arg(name,null);if(raw==null)return null;
  const value=Number(raw);
  if(!Number.isFinite(value)||(integer&&!Number.isInteger(value))||(min!=null&&value<min)) throw new Error(`invalid ${name} ${raw}`);
  return value;
}
const outDir=path.resolve(arg('--out','cash-pro-lab-highrake-campaign'));
const split=arg('--split',null);
const maxRaw=arg('--max',null);
const max=maxRaw==null?Infinity:Number(maxRaw);
if(split&&!['train','dev','holdout'].includes(split)) throw new Error(`invalid --split ${split}`);
if(max!==Infinity&&(!Number.isInteger(max)||max<1)) throw new Error(`invalid --max ${maxRaw}`);
const compute={};
const threads=optionalNumber('--threads',{integer:true,min:1});
const targetExploitabilityPct=optionalNumber('--target-exploitability',{min:Number.EPSILON});
const maxIterations=optionalNumber('--max-iterations',{integer:true,min:1});
const reportEvery=optionalNumber('--report-every',{integer:true,min:1});
if(threads!=null)compute.threads=threads;
if(targetExploitabilityPct!=null)compute.targetExploitabilityPct=targetExploitabilityPct;
if(maxIterations!=null)compute.maxIterations=maxIterations;
if(reportEvery!=null)compute.reportEvery=reportEvery;

const campaign=materializeCurrentHighRakeCampaign({split,compute});
if(!campaign.ok) throw new Error(`high-rake campaign materialization failed: ${campaign.errors.join(', ')}`);
fs.mkdirSync(outDir,{recursive:true});
const selected=max===Infinity?campaign.jobs:campaign.jobs.slice(0,max);
const manifestJobs=[];
for(const row of selected){
  const configPath=path.join(outDir,row.configFile);
  const outputPath=path.join(outDir,row.outputFile);
  fs.mkdirSync(path.dirname(configPath),{recursive:true});
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(configPath,row.job.configToml,'utf8');
  manifestJobs.push({
    id:row.id,split:row.split,configFile:row.configFile,outputFile:row.outputFile,
    solveRootFingerprint:row.solveRootFingerprint,solveRootFingerprintVersion:row.solveRootFingerprintVersion,
    abstractRootKey:row.abstractRootKey,abstractTexture:row.abstractTexture,
    job:row.job,
  });
}
const manifest={
  version:'cash-pro-lab-highrake-external-manifest-v1',
  generatedAt:new Date().toISOString(),
  campaignId:campaign.campaignId,
  sourceCampaign:campaign.sourceCampaign,
  summary:{...campaign.baseSummary,materializedJobs:manifestJobs.length,bySplit:campaign.materialized.bySplit},
  jobs:manifestJobs,
  execution:{
    provider:'ucsandman/postflop',
    sourceCommit:manifestJobs[0]?.job?.engine?.sourceCommit??null,
    binaryBundled:false,autoDownload:false,
    compileLocally:true,
    computeOverride:Object.keys(compute).length?compute:null,
    note:'Compile the pinned source locally. Runner hashes the exact executable and config before accepting any output. Any compute override is explicit in this manifest and changes the provider fingerprint.',
  },
  authority:{executedRoots:0,validatedStrategyOracleRoots:0,alternativeEvOracleRoots:0,certifiedStudies:0},
};
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({ok:true,outDir,jobs:manifestJobs.length,manifest:path.join(outDir,'manifest.json'),computeOverride:manifest.execution.computeOverride,authority:manifest.authority},null,2));
