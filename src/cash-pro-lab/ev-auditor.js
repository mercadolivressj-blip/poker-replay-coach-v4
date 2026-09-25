const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const upper=(v)=>String(v??'').trim().toUpperCase();

function severity(lossBB){
  if(!finite(lossBB)) return 'unknown';
  if(lossBB<0.02) return 'negligible';
  if(lossBB<0.10) return 'small';
  if(lossBB<0.50) return 'material';
  if(lossBB<2.00) return 'major';
  return 'catastrophic';
}

export function auditDecisionEV(node={},studentResult={},consensus={}){
  if(consensus?.blocked) return {version:'cash-pro-lab-ev-audit-v1',blocked:true,reason:'oracle_consensus_blocked'};
  const action=upper(studentResult?.action);
  const legal=Array.isArray(node.legalActions)?node.legalActions:[];
  if(!action||!legal.includes(action)) return {version:'cash-pro-lab-ev-audit-v1',blocked:true,reason:'student_action_illegal'};
  const studentEV=consensus?.evByAction?.[action];
  const bestAction=consensus?.bestAction;
  const bestEV=consensus?.bestEV;
  if(!finite(studentEV)||!finite(bestEV)||!bestAction) return {version:'cash-pro-lab-ev-audit-v1',blocked:true,reason:'ev_missing'};
  const evLossBB=Math.max(0,bestEV-studentEV);
  return {
    version:'cash-pro-lab-ev-audit-v1',
    blocked:false,
    fingerprint:node.fingerprint??null,
    street:node.street??null,
    highImpact:consensus.highImpact===true,
    studentAction:action,
    studentEV,
    bestAction,
    bestEV,
    evLossBB,
    severity:severity(evLossBB),
    exactMatch:action===bestAction,
    consensusConfidence:consensus.confidence??0,
    oracleCount:consensus.eligibleCount??0,
    evByAction:{...(consensus.evByAction||{})},
  };
}

export function summarizeEVAudits(audits=[]){
  const rows=(Array.isArray(audits)?audits:[]).filter(a=>a&&!a.blocked&&finite(a.evLossBB));
  const totalEvLossBB=rows.reduce((s,a)=>s+a.evLossBB,0);
  const highImpact=rows.filter(a=>a.highImpact);
  const catastrophic=rows.filter(a=>a.severity==='catastrophic');
  const major=rows.filter(a=>a.severity==='major'||a.severity==='catastrophic');
  return {
    version:'cash-pro-lab-ev-summary-v1',
    decisions:rows.length,
    totalEvLossBB,
    avgEvLossBB:rows.length?totalEvLossBB/rows.length:null,
    highImpactDecisions:highImpact.length,
    highImpactEvLossBB:highImpact.reduce((s,a)=>s+a.evLossBB,0),
    majorErrors:major.length,
    catastrophicErrors:catastrophic.length,
    exactMatches:rows.filter(a=>a.exactMatch).length,
  };
}
