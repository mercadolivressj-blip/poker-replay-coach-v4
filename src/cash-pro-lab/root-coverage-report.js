import { strategicCurriculumManifest, iterateStrategicCurriculum } from './strategic-curriculum.js';
import { planReusableSolveRoots } from './solve-root-planner.js';
import { BASELINE_META } from '../strategy-v1/ranges-100z.js';
import { HIGHRake_POSTFLOP_ENGINE } from './highrake-postflop-job-builder.js';

function splitRootCounts(roots=[]){
  const out={train:0,dev:0,holdout:0,unknown:0};
  for(const root of roots){
    const active=Object.entries(root?.splits||{}).filter(([,count])=>Number(count)>0).map(([split])=>split);
    if(active.length!==1){out.unknown++;continue;}
    if(Object.hasOwn(out,active[0])) out[active[0]]++;
    else out.unknown++;
  }
  return out;
}

function supportedMatchups(roots=[]){
  const map=new Map();
  for(const root of roots){
    const key=`${root.openerPosition}->${root.defenderPosition}`;
    const row=map.get(key)||{path:key,openerPosition:root.openerPosition,defenderPosition:root.defenderPosition,roots:0,ticketReferences:0};
    row.roots++;
    row.ticketReferences+=Number(root.ticketReferences)||0;
    map.set(key,row);
  }
  return [...map.values()].sort((a,b)=>b.ticketReferences-a.ticketReferences||a.path.localeCompare(b.path));
}

export function buildCurrentTeacherCoverageReport({maxTickets=Infinity}={}){
  const curriculum=strategicCurriculumManifest();
  const huTickets=iterateStrategicCurriculum({lanes:['postflop-heads-up']});
  const plan=planReusableSolveRoots(huTickets,{maxTickets});
  const huTotal=curriculum.lanes['postflop-heads-up'].tickets;
  const entireTotal=curriculum.tickets;
  const eligible=plan.eligibleTickets;
  const rootsBySplit=splitRootCounts(plan.roots);
  const matchups=supportedMatchups(plan.roots);
  const rakePercent=Number(String(BASELINE_META.rake||'').replace('%',''));
  const rakeCapBB=Number(BASELINE_META.rakeCapBB);
  return {
    version:'cash-pro-lab-current-teacher-coverage-v2',
    curriculum:{
      totalTickets:entireTotal,
      huTickets:huTotal,
      preflopTickets:curriculum.lanes.preflop.tickets,
      multiwayTickets:curriculum.lanes['postflop-multiway'].tickets,
    },
    routableRootDomain:{
      status:'CONFIGURABLE_NOT_EXECUTED',
      description:'Frozen 100z preflop ranges + explicit 100bb SRP economics can be materialized into postflop high-rake solve configs. This is routing coverage, not solved-teacher coverage.',
      ticketsSeen:plan.ticketsSeen,
      routableTickets:eligible,
      huCoverage:huTotal?eligible/huTotal:0,
      wholeCurriculumCoverage:entireTotal?eligible/entireTotal:0,
      uniqueSolveRoots:plan.uniqueSolveRoots,
      rootReferences:plan.rootReferences,
      compressionRatio:plan.compressionRatio,
      rootsBySplit,
      supportedPaths:matchups,
      rakeTarget:{percent:rakePercent,capBB:rakeCapBB,sourceBaselineVersion:BASELINE_META.version},
    },
    teacherAuthority:{
      highRakeStrategyTeacher:{
        provider:HIGHRake_POSTFLOP_ENGINE.family,
        providerSourceCommit:HIGHRake_POSTFLOP_ENGINE.sourceCommit,
        configuredCandidateTickets:eligible,
        configuredCandidateRoots:plan.uniqueSolveRoots,
        executedRoots:0,
        validatedStrategyOracleRoots:0,
        validatedStrategyOracleTickets:0,
        alternativeEvOracleRoots:0,
        certifiedStudies:0,
        exactHighRakeAuthority:false,
        reason:'Authority stays false until external solutions are executed and pass exact config, rake, structure and measured-exploitability validation. Alternative-EV authority additionally requires per-action EV evidence.',
      },
      legacyTexasSolver:{
        role:'independent no-rake structural/parity teacher only',
        postflopRakeSupportedByCurrentPath:false,
        exactHighRakeAuthority:false,
        certifiedStudies:0,
      },
    },
    blocked:{
      tickets:Math.max(0,plan.ticketsSeen-eligible),
      rejectionCounts:{...plan.rejectionCounts},
    },
    splitIntegrity:{...plan.splitIntegrity,valid:plan.valid},
    claims:{
      plannedTickets:entireTotal,
      routableHighRakeConfigTickets:eligible,
      executedHighRakeSolverTrees:0,
      validatedHighRakeStrategyTickets:0,
      certifiedStudies:0,
      legacyTexasSolverHighRakeAuthority:false,
    },
    nextCoveragePriorities:[
      'execute a small pilot of exact 5% / 2.5bb-cap high-rake roots and validate solution envelopes',
      'extract or independently compute per-action alternative EVs before enabling EV-loss teaching from the high-rake solver',
      'add an independent rake-capable second teacher family for high-impact consensus',
      'add exact 100bb 3bet-pot range profile and teacher lane',
      'add stack-specific preflop/postflop teachers before enabling 20/30/40/50/75/150/200bb',
      'add a genuine multiway teacher before certifying multiway tickets',
    ],
    note:'Routing/configuration coverage and teacher authority are deliberately separate. No external solve has been counted here. A ticket becomes studied only after exact-state proof, validated solver evidence, required independent-teacher consensus and EV audit.',
  };
}
