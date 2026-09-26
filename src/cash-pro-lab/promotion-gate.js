import { summarizeEVAudits } from './ev-auditor.js';

const finite=(v)=>typeof v==='number'&&Number.isFinite(v);

function indexByFingerprint(rows=[]){
  const map=new Map();
  for(const row of rows){
    if(row?.fingerprint) map.set(row.fingerprint,row);
  }
  return map;
}

export function certifyChallenger({championAudits=[],challengerAudits=[],violations={},options={}}={}){
  const minNodes=options.minNodes??500;
  const maxAvgRegressionBB=options.maxAvgRegressionBB??0;
  const maxHighImpactRegressionBB=options.maxHighImpactRegressionBB??0;
  const maxCatastrophicErrors=options.maxCatastrophicErrors??0;

  const champion=indexByFingerprint(championAudits);
  const challenger=indexByFingerprint(challengerAudits);
  const paired=[];
  for(const [fingerprint,c] of challenger.entries()){
    const base=champion.get(fingerprint);
    if(base&&!base.blocked&&!c.blocked&&finite(base.evLossBB)&&finite(c.evLossBB)) paired.push({fingerprint,champion:base,challenger:c});
  }

  const championSummary=summarizeEVAudits(paired.map(p=>p.champion));
  const challengerSummary=summarizeEVAudits(paired.map(p=>p.challenger));
  const reasons=[];

  if(paired.length<minNodes) reasons.push('insufficient_paired_nodes');
  if((violations.illegalActions??0)>0) reasons.push('illegal_action_violation');
  if((violations.terminalStateErrors??0)>0) reasons.push('terminal_state_violation');
  if((violations.unprovenDecisions??0)>0) reasons.push('unproven_decision_violation');
  if((challengerSummary.catastrophicErrors??0)>maxCatastrophicErrors) reasons.push('catastrophic_error_budget_exceeded');

  if(finite(championSummary.avgEvLossBB)&&finite(challengerSummary.avgEvLossBB)){
    const regression=challengerSummary.avgEvLossBB-championSummary.avgEvLossBB;
    if(regression>maxAvgRegressionBB+1e-12) reasons.push('average_ev_regression');
  } else reasons.push('average_ev_unavailable');

  if(finite(championSummary.highImpactEvLossBB)&&finite(challengerSummary.highImpactEvLossBB)){
    const regression=challengerSummary.highImpactEvLossBB-championSummary.highImpactEvLossBB;
    if(regression>maxHighImpactRegressionBB+1e-12) reasons.push('high_impact_ev_regression');
  }

  return {
    version:'cash-pro-lab-promotion-gate-v1',
    pairedNodes:paired.length,
    champion:championSummary,
    challenger:challengerSummary,
    violations:{
      illegalActions:violations.illegalActions??0,
      terminalStateErrors:violations.terminalStateErrors??0,
      unprovenDecisions:violations.unprovenDecisions??0,
    },
    eligibleForHumanReview:reasons.length===0,
    autoPromote:false,
    reasons,
  };
}
