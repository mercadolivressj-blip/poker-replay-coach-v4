const finite=v=>typeof v==='number'&&Number.isFinite(v);

function indexHoldout(rows=[]){
  const map=new Map();
  const duplicates=[];
  const nonHoldout=[];
  for(const row of Array.isArray(rows)?rows:[]){
    if(row?.ticket?.split!=='holdout'){nonHoldout.push(row);continue;}
    const fp=row?.node?.fingerprint||row?.audit?.fingerprint;
    if(!fp||row?.status!=='STUDIED'||!finite(row?.audit?.evLossBB)) continue;
    if(map.has(fp)){duplicates.push(fp);continue;}
    map.set(fp,row);
  }
  return {map,duplicates,nonHoldout};
}

function mean(values=[]){return values.length?values.reduce((s,x)=>s+x,0)/values.length:null;}
function sampleSd(values=[]){
  if(values.length<2) return 0;
  const m=mean(values);return Math.sqrt(values.reduce((s,x)=>s+(x-m)**2,0)/(values.length-1));
}
function percentile(values=[],p=.95){
  if(!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const i=Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1));
  return sorted[i];
}

export function certifyPairedHoldout({championEvaluations=[],challengerEvaluations=[],violations={},options={}}={}){
  const minNodes=options.minNodes??5000;
  const minHighImpactNodes=options.minHighImpactNodes??500;
  const maxMeanDeltaBB=options.maxMeanDeltaBB??0;
  const maxHighImpactMeanDeltaBB=options.maxHighImpactMeanDeltaBB??0;
  const maxP95RegressionBB=options.maxP95RegressionBB??0.25;
  const requireCI95=options.requireCI95!==false;
  const requireExclusiveHoldout=options.requireExclusiveHoldout!==false;

  const champion=indexHoldout(championEvaluations),challenger=indexHoldout(challengerEvaluations);
  const pairs=[];
  for(const [fp,c] of challenger.map.entries()){
    const b=champion.map.get(fp);if(b)pairs.push({fingerprint:fp,champion:b,challenger:c});
  }
  const deltas=pairs.map(p=>p.challenger.audit.evLossBB-p.champion.audit.evLossBB);
  const high=pairs.filter(p=>p.champion.audit.highImpact||p.challenger.audit.highImpact);
  const highDeltas=high.map(p=>p.challenger.audit.evLossBB-p.champion.audit.evLossBB);
  const avgDeltaBB=mean(deltas);
  const sd=sampleSd(deltas);
  const se=deltas.length?sd/Math.sqrt(deltas.length):null;
  const ci95={lower:finite(avgDeltaBB)&&finite(se)?avgDeltaBB-1.96*se:null,upper:finite(avgDeltaBB)&&finite(se)?avgDeltaBB+1.96*se:null};
  const highImpactAvgDeltaBB=mean(highDeltas);
  const regressions=deltas.filter(x=>x>0);
  const p95RegressionBB=percentile(regressions,.95)??0;
  const reasons=[];

  if(pairs.length<minNodes) reasons.push('insufficient_holdout_pairs');
  if(high.length<minHighImpactNodes) reasons.push('insufficient_high_impact_pairs');
  if(champion.duplicates.length||challenger.duplicates.length) reasons.push('duplicate_holdout_fingerprint');
  if(requireExclusiveHoldout&&(champion.nonHoldout.length||challenger.nonHoldout.length)) reasons.push('non_holdout_evidence_supplied');
  if((violations.illegalActions??0)>0) reasons.push('illegal_action_violation');
  if((violations.terminalStateErrors??0)>0) reasons.push('terminal_state_violation');
  if((violations.unprovenDecisions??0)>0) reasons.push('unproven_decision_violation');
  if((violations.holdoutLeakage??0)>0) reasons.push('holdout_leakage_violation');
  if(!finite(avgDeltaBB)) reasons.push('holdout_delta_unavailable');
  else if(avgDeltaBB>maxMeanDeltaBB+1e-12) reasons.push('mean_holdout_ev_regression');
  if(finite(highImpactAvgDeltaBB)&&highImpactAvgDeltaBB>maxHighImpactMeanDeltaBB+1e-12) reasons.push('high_impact_holdout_regression');
  if(p95RegressionBB>maxP95RegressionBB+1e-12) reasons.push('tail_regression_budget_exceeded');
  if(requireCI95&&finite(ci95.upper)&&ci95.upper>0) reasons.push('improvement_not_95pct_confident');

  return {
    version:'cash-pro-lab-holdout-certifier-v1',
    pairedNodes:pairs.length,
    highImpactPairs:high.length,
    avgDeltaBB,
    totalDeltaBB:deltas.reduce((s,x)=>s+x,0),
    highImpactAvgDeltaBB,
    p95RegressionBB,
    better:pairs.filter(p=>p.challenger.audit.evLossBB<p.champion.audit.evLossBB).length,
    worse:pairs.filter(p=>p.challenger.audit.evLossBB>p.champion.audit.evLossBB).length,
    tied:pairs.filter(p=>p.challenger.audit.evLossBB===p.champion.audit.evLossBB).length,
    ci95,
    duplicates:{champion:champion.duplicates.length,challenger:challenger.duplicates.length},
    suppliedNonHoldout:{champion:champion.nonHoldout.length,challenger:challenger.nonHoldout.length},
    violations:{
      illegalActions:violations.illegalActions??0,
      terminalStateErrors:violations.terminalStateErrors??0,
      unprovenDecisions:violations.unprovenDecisions??0,
      holdoutLeakage:violations.holdoutLeakage??0,
    },
    eligibleForHumanReview:reasons.length===0,
    autoPromote:false,
    reasons,
    note:'Certification is paired on exact frozen holdout fingerprints. Even a passing challenger is never auto-promoted.',
  };
}
