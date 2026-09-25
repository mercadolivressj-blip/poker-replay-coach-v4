import crypto from 'node:crypto';
import { BASELINE_META } from '../strategy-v1/ranges-100z.js';
import { prove100zSrpFlopSolveRoot } from './solve-root.js';
import { createSolverTreeProfile, treeProfileKey } from './solver-tree-profile.js';

export const HIGHRake_POSTFLOP_ENGINE=Object.freeze({
  family:'ucsandman/postflop',
  sourceCommit:'5fc7ee3d92b823b6c58e4f58cbee7d50d5e9e6de',
  license:'MIT',
  cli:'solver solve --config <spot.toml> --report-every <n> --out <solution.json>',
});

function finite(v){return typeof v==='number'&&Number.isFinite(v);}
function numberText(v){
  const n=Number(v);
  if(!Number.isFinite(n)) throw new TypeError('non_finite_number');
  return Number.isInteger(n)?`${n}.0`:String(Number(n.toFixed(8)));
}
function quoteToml(value){return JSON.stringify(String(value));}
function safeFilename(value){return String(value||'solve').replace(/[^A-Za-z0-9._-]+/g,'_').slice(0,180);}
function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}
function profileOrError(treeProfile){
  if(treeProfile?.version==='cash-pro-lab-solver-tree-profile-v1') return {ok:true,profile:treeProfile,errors:[]};
  return createSolverTreeProfile(treeProfile||{});
}
function rakeFromBaseline(){
  const percent=Number(String(BASELINE_META.rake||'').replace('%',''));
  const cap=Number(BASELINE_META.rakeCapBB);
  if(!finite(percent)||percent<0||!finite(cap)||cap<0) return null;
  return {percent,cap,profile:`${percent}% cap ${cap}bb`};
}
function actionTable(profile,position,street,kind){
  return profile.actions.find(a=>a.position===position&&a.street===street&&a.kind===kind)||null;
}
function rowHasAllin(profile,position,street){
  return profile.actions.some(a=>a.position===position&&a.street===street&&a.kind==='allin');
}
function tomlSizing(table,allin){
  const bits=[];
  if(table?.sizes?.length) bits.push(`percents = [${table.sizes.map(numberText).join(', ')}]`);
  if(allin) bits.push('allin = true');
  return bits.length?`{ ${bits.join(', ')} }`:null;
}
function buildSizingLines(profile){
  const lines=[];
  for(const position of ['oop','ip']){
    for(const street of ['flop','turn','river']){
      const allin=rowHasAllin(profile,position,street);
      const entries=[];
      for(const kind of ['bet','raise','donk']){
        const table=actionTable(profile,position,street,kind);
        const text=tomlSizing(table,allin&&kind!=='donk');
        if(text) entries.push([kind,text]);
      }
      if(!entries.length) continue;
      lines.push('',`[sizings.${position}.${street}]`);
      for(const [kind,text] of entries) lines.push(`${kind} = ${text}`);
    }
  }
  return lines;
}

export function buildHighRakePostflopFlopJob({root={},treeProfile,outputFile=null,compute={}}={}){
  const rootProof=prove100zSrpFlopSolveRoot(root);
  const treeResult=profileOrError(treeProfile);
  const rake=rakeFromBaseline();
  const errors=[...rootProof.errors,...(treeResult.ok?[]:treeResult.errors.map(e=>`tree_profile:${e}`))];
  if(!rake) errors.push('baseline_rake_invalid');
  if(root.rakeProfile!=='100z-high-rake') errors.push('root_rake_profile_not_high_rake');
  if(errors.length) return {version:'cash-pro-lab-highrake-postflop-job-v1',ok:false,errors:[...new Set(errors)],rootProof,job:null};

  const profile=treeResult.profile;
  const targetExploitability=Number(compute.targetExploitabilityPct??0.25);
  const maxIterations=Number(compute.maxIterations??10000);
  const reportEvery=Number(compute.reportEvery??100);
  const threads=Number(compute.threads??profile.compute.threadNum??8);
  if(!finite(targetExploitability)||targetExploitability<=0) errors.push('target_exploitability_invalid');
  if(!Number.isInteger(maxIterations)||maxIterations<1) errors.push('max_iterations_invalid');
  if(!Number.isInteger(reportEvery)||reportEvery<1) errors.push('report_every_invalid');
  if(!Number.isInteger(threads)||threads<1) errors.push('threads_invalid');
  if(errors.length) return {version:'cash-pro-lab-highrake-postflop-job-v1',ok:false,errors:[...new Set(errors)],rootProof,job:null};

  const filename=safeFilename(outputFile||`${root.fingerprint}_${treeProfileKey(profile)}_highrake.json`);
  const lines=[
    `board = ${quoteToml(root.board.join(' '))}`,
    `oop_range = ${quoteToml(root.rangeOop)}`,
    `ip_range = ${quoteToml(root.rangeIp)}`,
    `effective_stack = ${numberText(root.effectiveStackBB)}`,
    `starting_pot = ${numberText(root.potBB)}`,
    `allin_threshold = ${numberText(profile.allinThreshold*100)}`,
    'raise_cap = 2',
    `target_exploitability = ${numberText(targetExploitability)}`,
    `max_iterations = ${maxIterations}`,
    'alpha = 1.5',
    'beta = 0.0',
    'gamma = 2.0',
    'turn_chance_sampling = false',
    'regret_floor = false',
    '',
    '[rake]',
    `percent = ${numberText(rake.percent)}`,
    `cap = ${numberText(rake.cap)}`,
    ...buildSizingLines(profile),
    '',
  ];
  const configToml=lines.join('\n');
  const configSha256=sha256(configToml);
  const providerFingerprint=sha256(JSON.stringify({
    engine:HIGHRake_POSTFLOP_ENGINE,
    rootFingerprint:root.fingerprint,
    rangeIp:root.rangeIp,
    rangeOop:root.rangeOop,
    treeProfileKey:treeProfileKey(profile),
    rake,
    targetExploitability,
    maxIterations,
    reportEvery,
    threads,
    configSha256,
  }));

  return {
    version:'cash-pro-lab-highrake-postflop-job-v1',
    ok:true,
    errors:[],
    rootProof,
    job:{
      provider:'highrake-postflop-dcfr',
      providerFingerprint:`cplhr-${providerFingerprint.slice(0,32)}`,
      engine:{...HIGHRake_POSTFLOP_ENGINE},
      solveRootFingerprint:root.fingerprint,
      solveRootFingerprintVersion:root.fingerprintVersion,
      strategyProfile:root.strategyProfile,
      preflopModelProfile:root.preflopModelProfile,
      treeProfileKey:treeProfileKey(profile),
      expectedRanges:{oop:root.rangeOop,ip:root.rangeIp},
      rake:{...rake,sourceBaselineVersion:BASELINE_META.version,sourceSnapshotSha256:BASELINE_META.snapshotSha256},
      convergence:{targetExploitabilityPct:targetExploitability,maxIterations,reportEvery,threads,turnChanceSampling:false},
      root:{board:[...root.board],potBB:root.potBB,startingStackBB:root.startingStackBB,effectiveStackBB:root.effectiveStackBB,oopPosition:root.oopPosition,ipPosition:root.ipPosition},
      outputFile:filename,
      configToml,
      configSha256,
      invocation:{args:['solve','--config','<config>','--report-every',String(reportEvery),'--threads',String(threads),'--out','<output>']},
      authority:{
        highRakeDomain:true,
        strategyOracleCandidate:true,
        evAlternativeOracleCandidate:false,
        reason:'The saved solution carries measured exploitability and per-node strategies, but the persisted v1-v3 solution schema does not store per-action EV vectors for every combo.',
      },
      provenance:{
        builderVersion:'cash-pro-lab-highrake-postflop-job-v1',
        sourceRef:root.sourceRef??null,
        note:'External offline high-rake solve specification. It is not a certified study until the returned solution matches this exact config, convergence gate and downstream independent-teacher audit.',
      },
    },
  };
}
