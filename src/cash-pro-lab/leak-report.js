const finite=(v)=>typeof v==='number'&&Number.isFinite(v);

function add(map,key,audit){
  if(!key) return;
  const row=map.get(key)||{key,decisions:0,totalEvLossBB:0,maxEvLossBB:0,majorErrors:0,catastrophicErrors:0,highImpactDecisions:0};
  row.decisions++;
  row.totalEvLossBB+=audit.evLossBB;
  row.maxEvLossBB=Math.max(row.maxEvLossBB,audit.evLossBB);
  if(audit.severity==='major'||audit.severity==='catastrophic') row.majorErrors++;
  if(audit.severity==='catastrophic') row.catastrophicErrors++;
  if(audit.highImpact) row.highImpactDecisions++;
  map.set(key,row);
}

function finalize(map,dimension){
  return [...map.values()].map(row=>({
    dimension,
    ...row,
    avgEvLossBB:row.decisions?row.totalEvLossBB/row.decisions:0,
  })).sort((a,b)=>b.totalEvLossBB-a.totalEvLossBB||b.maxEvLossBB-a.maxEvLossBB);
}

export function buildLeakReport(evaluations=[]){
  const studied=(Array.isArray(evaluations)?evaluations:[]).filter(r=>r?.status==='STUDIED'&&r?.audit&&!r.audit.blocked&&finite(r.audit.evLossBB));
  const byStreet=new Map(),byPosition=new Map(),byTag=new Map(),byImpact=new Map(),bySeverity=new Map();
  let totalEvLossBB=0;
  for(const row of studied){
    const audit=row.audit,node=row.node||{};
    totalEvLossBB+=audit.evLossBB;
    add(byStreet,node.street||'unknown',audit);
    add(byPosition,node.heroPosition||'unknown',audit);
    add(byImpact,audit.highImpact?'high-impact':'standard',audit);
    add(bySeverity,audit.severity||'unknown',audit);
    for(const tag of Array.isArray(node.tags)?node.tags:[]) add(byTag,String(tag),audit);
  }
  const groups=[
    ...finalize(byStreet,'street'),
    ...finalize(byPosition,'position'),
    ...finalize(byImpact,'impact'),
    ...finalize(bySeverity,'severity'),
    ...finalize(byTag,'tag'),
  ].sort((a,b)=>b.totalEvLossBB-a.totalEvLossBB||b.maxEvLossBB-a.maxEvLossBB);
  return {
    version:'cash-pro-lab-leak-report-v1',
    studiedDecisions:studied.length,
    totalEvLossBB,
    avgEvLossBB:studied.length?totalEvLossBB/studied.length:null,
    topLeaks:groups.slice(0,25),
    byStreet:finalize(byStreet,'street'),
    byPosition:finalize(byPosition,'position'),
    byImpact:finalize(byImpact,'impact'),
    bySeverity:finalize(bySeverity,'severity'),
    byTag:finalize(byTag,'tag'),
  };
}
