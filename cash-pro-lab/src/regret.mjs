const finite=x=>Number.isFinite(Number(x));

export function auditDecision({selectedAction,actionEVs={}}){
  const rows=Object.entries(actionEVs).filter(([,ev])=>finite(ev)).map(([action,ev])=>({action,ev:Number(ev)}));
  if(!rows.length) return {auditable:false,reason:'no_action_evs'};
  rows.sort((a,b)=>b.ev-a.ev);
  const best=rows[0];
  const selected=rows.find(x=>x.action===selectedAction);
  if(!selected) return {auditable:false,reason:'selected_action_missing_ev',best};
  const regret=Math.max(0,best.ev-selected.ev);
  return {
    auditable:true,
    selected,
    best,
    regretBB:regret,
    severe:regret>=1,
    material:regret>=0.25,
    ranked:rows
  };
}

export function aggregateRegret(audits=[]){
  const valid=audits.filter(x=>x?.auditable);
  if(!valid.length) return {decisions:0,totalRegretBB:0,avgRegretBB:0,severeRate:0,materialRate:0};
  const total=valid.reduce((a,x)=>a+x.regretBB,0);
  return {
    decisions:valid.length,
    totalRegretBB:total,
    avgRegretBB:total/valid.length,
    severeRate:valid.filter(x=>x.severe).length/valid.length,
    materialRate:valid.filter(x=>x.material).length/valid.length
  };
}
