import {auditDecision} from './regret.mjs';

const keyOf=(x,fields)=>fields.map(f=>String(x?.[f]??'UNKNOWN')).join('|');

export function auditRecord(record={}){
  const audit=auditDecision({selectedAction:record.selectedAction,actionEVs:record.actionEVs});
  return {
    ...record,
    ...audit,
    street:String(record.street||'UNKNOWN').toLowerCase(),
    position:String(record.position||'UNKNOWN').toUpperCase(),
    depthBucket:String(record.depthBucket||'UNKNOWN'),
    node:String(record.node||'UNKNOWN'),
    opponentType:String(record.opponentType||'UNKNOWN')
  };
}

function summarize(rows=[]){
  const valid=rows.filter(x=>x.auditable);
  const total=valid.reduce((a,x)=>a+x.regretBB,0);
  const severe=valid.filter(x=>x.severe).length;
  const material=valid.filter(x=>x.material).length;
  const wrong=valid.filter(x=>x.regretBB>1e-12).length;
  const sorted=[...valid].sort((a,b)=>b.regretBB-a.regretBB);
  return {
    decisions:valid.length,
    totalRegretBB:total,
    avgRegretBB:valid.length?total/valid.length:0,
    wrongActionRate:valid.length?wrong/valid.length:0,
    materialRate:valid.length?material/valid.length:0,
    severeRate:valid.length?severe/valid.length:0,
    p95RegretBB:valid.length?sorted[Math.max(0,Math.floor(valid.length*.05)-1)]?.regretBB??0:0,
    maxRegretBB:sorted[0]?.regretBB??0
  };
}

function group(rows,fields){
  const m=new Map();
  for(const row of rows){
    const k=keyOf(row,fields);
    if(!m.has(k))m.set(k,[]);
    m.get(k).push(row);
  }
  return Object.fromEntries([...m.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,summarize(v)]));
}

export function buildRegretDashboard(records=[]){
  const audits=records.map(auditRecord);
  const valid=audits.filter(x=>x.auditable);
  const unauditable=audits.filter(x=>!x.auditable);
  const highCost=[...valid].filter(x=>x.regretBB>=.25).sort((a,b)=>b.regretBB-a.regretBB).slice(0,50).map(x=>({
    id:x.id??null,street:x.street,position:x.position,depthBucket:x.depthBucket,node:x.node,
    opponentType:x.opponentType,selectedAction:x.selectedAction,bestAction:x.best?.action??null,
    regretBB:x.regretBB,actionEVs:x.actionEVs
  }));
  return {
    version:'regret-dashboard-v0.5',
    overall:summarize(valid),
    byStreet:group(valid,['street']),
    byPosition:group(valid,['position']),
    byDepth:group(valid,['depthBucket']),
    byNode:group(valid,['node']),
    byOpponentType:group(valid,['opponentType']),
    byStreetAndNode:group(valid,['street','node']),
    highCost,
    unauditable:{count:unauditable.length,reasons:Object.fromEntries(Object.entries(unauditable.reduce((a,x)=>(a[x.reason]=(a[x.reason]||0)+1,a),{})).sort())}
  };
}

export function promotionGate(dashboard,{
  maxAvgRegretBB=.06,
  maxMaterialRate=.06,
  maxSevereRate=.01,
  maxUnauditableRate=.02,
  minAuditedDecisions=5000
}={}){
  const d=dashboard?.overall||{};
  const audited=Number(d.decisions||0),unaudited=Number(dashboard?.unauditable?.count||0),total=audited+unaudited;
  const reasons=[];
  if(audited<minAuditedDecisions)reasons.push('insufficient_audited_decisions');
  if(Number(d.avgRegretBB||0)>maxAvgRegretBB)reasons.push('avg_regret_too_high');
  if(Number(d.materialRate||0)>maxMaterialRate)reasons.push('material_error_rate_too_high');
  if(Number(d.severeRate||0)>maxSevereRate)reasons.push('severe_error_rate_too_high');
  if(total && unaudited/total>maxUnauditableRate)reasons.push('unauditable_rate_too_high');
  return {promotable:reasons.length===0,reasons,thresholds:{maxAvgRegretBB,maxMaterialRate,maxSevereRate,maxUnauditableRate,minAuditedDecisions}};
}
