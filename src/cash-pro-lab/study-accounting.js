const finite=v=>typeof v==='number'&&Number.isFinite(v);

function addCounts(target={},source={}){
  for(const [key,value] of Object.entries(source||{})) target[key]=(target[key]||0)+(Number(value)||0);
  return target;
}

export function buildStudyAccounting({plannedTickets=0,runs=[],artifactSummaries=[]}={}){
  const list=Array.isArray(runs)?runs:[];
  const artifacts=Array.isArray(artifactSummaries)?artifactSummaries:[];
  const totals={ticketsSeen:0,processedNodes:0,studiedNodes:0,blockedNodes:0,nodeFactoryBlocked:0,oracleProviderBlocked:0};
  const blockedByPhase={};
  let totalEvLossBB=0,highImpactDecisions=0,majorErrors=0,catastrophicErrors=0;
  for(const run of list){
    for(const key of Object.keys(totals)) totals[key]+=Number(run?.[key])||0;
    addCounts(blockedByPhase,run?.blockedByPhase);
    totalEvLossBB+=Number(run?.evSummary?.totalEvLossBB)||0;
    highImpactDecisions+=Number(run?.evSummary?.highImpactDecisions)||0;
    majorErrors+=Number(run?.evSummary?.majorErrors)||0;
    catastrophicErrors+=Number(run?.evSummary?.catastrophicErrors)||0;
  }
  const teacherRows=artifacts.reduce((s,a)=>s+(Number(a?.rows)||0),0);
  const teacherIndexed=artifacts.reduce((s,a)=>s+(Number(a?.indexed)||0),0);
  const teacherRejected=artifacts.reduce((s,a)=>s+(Number(a?.rejected)||0),0);
  const families=[...new Set(artifacts.flatMap(a=>Array.isArray(a?.families)?a.families:[]).map(String))];
  const warnings=[];
  if(totals.studiedNodes>totals.processedNodes) warnings.push('studied_exceeds_processed');
  if(totals.processedNodes+totals.nodeFactoryBlocked+totals.oracleProviderBlocked>totals.ticketsSeen) warnings.push('outcomes_exceed_tickets_seen');
  if(plannedTickets>0&&totals.ticketsSeen>plannedTickets) warnings.push('tickets_seen_exceeds_plan');
  if(teacherIndexed>teacherRows) warnings.push('teacher_indexed_exceeds_rows');
  if(teacherRejected>teacherRows) warnings.push('teacher_rejected_exceeds_rows');

  const generatedButNotStudied=Math.max(0,totals.ticketsSeen-totals.studiedNodes);
  return {
    version:'cash-pro-lab-study-accounting-v1',
    plannedTickets:Number(plannedTickets)||0,
    ticketsEnumerated:totals.ticketsSeen,
    nodesProcessed:totals.processedNodes,
    certifiedStudies:totals.studiedNodes,
    blockedOrUnstudied:generatedButNotStudied,
    blockedNodes:totals.blockedNodes,
    nodeFactoryBlocked:totals.nodeFactoryBlocked,
    oracleProviderBlocked:totals.oracleProviderBlocked,
    blockedByPhase,
    studyYield:totals.ticketsSeen?totals.studiedNodes/totals.ticketsSeen:null,
    planCompletion:plannedTickets>0?totals.ticketsSeen/plannedTickets:null,
    teacherCorpus:{rows:teacherRows,indexed:teacherIndexed,rejected:teacherRejected,families},
    ev:{totalEvLossBB,highImpactDecisions,majorErrors,catastrophicErrors},
    warnings,
    honestClaim:`${totals.studiedNodes} certified studies from ${totals.ticketsSeen} enumerated curriculum tickets`,
    note:'Only certifiedStudies may be described as completed studies. Planned or enumerated tickets are not solver-certified studies.',
  };
}

export function validateStudyAccounting(accounting={}){
  const errors=[];
  for(const key of ['plannedTickets','ticketsEnumerated','nodesProcessed','certifiedStudies','blockedOrUnstudied']){
    const value=accounting?.[key];if(!finite(value)||value<0) errors.push(`invalid:${key}`);
  }
  if(finite(accounting.certifiedStudies)&&finite(accounting.ticketsEnumerated)&&accounting.certifiedStudies>accounting.ticketsEnumerated) errors.push('certified_exceeds_enumerated');
  if(finite(accounting.nodesProcessed)&&finite(accounting.ticketsEnumerated)&&accounting.nodesProcessed>accounting.ticketsEnumerated) errors.push('processed_exceeds_enumerated');
  return {ok:errors.length===0,errors};
}
