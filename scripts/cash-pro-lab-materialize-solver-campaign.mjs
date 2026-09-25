import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeCurrent100zSrpCampaign } from '../src/cash-pro-lab/solve-campaign-materializer.js';

function arg(name,fallback=null){
  const i=process.argv.indexOf(name);
  return i>=0&&process.argv[i+1]!=null?process.argv[i+1]:fallback;
}
const outDir=path.resolve(arg('--out','cash-pro-lab-solver-campaign'));
const split=arg('--split',null);
if(split&&!['train','dev','holdout'].includes(split)) throw new Error(`invalid --split ${split}`);

const campaign=materializeCurrent100zSrpCampaign({split});
if(!campaign.ok) throw new Error(`campaign materialization failed: ${campaign.errors.join(', ')}`);
fs.mkdirSync(outDir,{recursive:true});

const manifestJobs=[];
for(const row of campaign.jobs){
  const commandPath=path.join(outDir,row.commandFile);
  const outputPath=path.join(outDir,row.outputFile);
  fs.mkdirSync(path.dirname(commandPath),{recursive:true});
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  const outputBasename=path.basename(outputPath);
  const commandText=row.job.commandText.replace(/^dump_result\s+.+$/m,`dump_result ${outputBasename}`);
  fs.writeFileSync(commandPath,commandText,'utf8');
  manifestJobs.push({
    id:row.root.fingerprint,
    split:row.split,
    abstractRootKey:row.abstractRootKey,
    abstractTexture:row.abstractTexture,
    board:row.root.board,
    openerPosition:row.root.openerPosition,
    defenderPosition:row.root.defenderPosition,
    potBB:row.root.potBB,
    effectiveStackBB:row.root.effectiveStackBB,
    preflopModelProfile:row.root.preflopModelProfile,
    strategyProfile:row.root.strategyProfile,
    treeProfileKey:row.job.treeProfile.key,
    commandFile:row.commandFile,
    outputFile:row.outputFile,
    solverOutputBasename:outputBasename,
    solveRootFingerprint:row.root.fingerprint,
    solveRootFingerprintVersion:row.root.fingerprintVersion,
    sourceRef:row.root.sourceRef,
  });
}
const manifest={
  version:'cash-pro-lab-external-solver-manifest-v1',
  generatedAt:new Date().toISOString(),
  generator:fileURLToPath(import.meta.url),
  campaign:campaign.campaign,
  summary:{...campaign.materialized,eligibleTickets:campaign.planner.eligibleTickets,abstractRoots:campaign.planner.uniqueAbstractRoots},
  jobs:manifestJobs,
  execution:{
    solver:'TexasSolver console external process',
    invocation:'console_solver -i <command-file>',
    binaryBundled:false,
    autoDownload:false,
    note:'The manifest contains planned external solves only. No job is a certified study until its output passes validation and classroom audit.',
  },
};
fs.writeFileSync(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({ok:true,outDir,jobs:manifest.jobs.length,bySplit:campaign.materialized.bySplit,manifest:path.join(outDir,'manifest.json')},null,2));
