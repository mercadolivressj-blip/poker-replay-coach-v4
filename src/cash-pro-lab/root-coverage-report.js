import { strategicCurriculumManifest, iterateStrategicCurriculum } from './strategic-curriculum.js';
import { planReusableSolveRoots } from './solve-root-planner.js';

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
  return {
    version:'cash-pro-lab-current-teacher-coverage-v1',
    currentTeacher:'frozen-100z-SRP-range-profile + external-TexasSolver-job-path',
    curriculum:{
      totalTickets:entireTotal,
      huTickets:huTotal,
      preflopTickets:curriculum.lanes.preflop.tickets,
      multiwayTickets:curriculum.lanes['postflop-multiway'].tickets,
    },
    exactDomain:{
      ticketsSeen:plan.ticketsSeen,
      eligibleTickets:eligible,
      huCoverage:huTotal?eligible/huTotal:0,
      wholeCurriculumCoverage:entireTotal?eligible/entireTotal:0,
      uniqueSolveRoots:plan.uniqueSolveRoots,
      rootReferences:plan.rootReferences,
      compressionRatio:plan.compressionRatio,
      rootsBySplit,
      supportedPaths:matchups,
    },
    blocked:{
      tickets:Math.max(0,plan.ticketsSeen-eligible),
      rejectionCounts:{...plan.rejectionCounts},
    },
    splitIntegrity:{...plan.splitIntegrity,valid:plan.valid},
    claims:{
      plannedTickets:entireTotal,
      currentExactDomainTickets:eligible,
      certifiedStudies:0,
      solverTreesExecutedByThisReport:0,
    },
    nextCoveragePriorities:[
      'execute and validate external 100bb SRP solver roots',
      'add independent second teacher family for high-impact nodes',
      'add exact 100bb 3bet-pot range profile and teacher lane',
      'add stack-specific preflop/postflop teachers before enabling 20/30/40/50/75/150/200bb',
      'add a genuine multiway teacher before certifying multiway tickets',
    ],
    note:'Coverage means exact-domain tickets that can be routed to the current 100z SRP teacher path. It is not a count of completed solver studies. certifiedStudies remains zero until external outputs are ingested and each decision passes proof, independent teacher consensus and EV audit.',
  };
}
