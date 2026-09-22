const clean=(v)=>String(v??'').replace(/\s+/g,' ').trim();
const canon=(v)=>clean(v).toLowerCase();
const MONEY_ACTIONS=new Set(['CALL','BET','RAISE','ALLIN']);

function sameSubject(c,d){
  const ca=canon(c?.actor),da=canon(d?.actor);
  if(ca&&da&&ca===da)return true;
  const cs=clean(c?.seatId),ds=clean(d?.seatId);
  return Boolean(cs&&ds&&cs===ds);
}

function inWindow(c,d,{leadMs=700,trailMs=9000}={}){
  const ct=Number(c?.capturedAt)||0,dt=Number(d?.capturedAt)||0;
  const from=Number(d?.fromObservedAt)||Math.max(0,dt-trailMs);
  return ct>=Math.max(0,from-leadMs)&&ct<=dt+leadMs;
}

export function reconcileActionSizing(candidates=[],financialDeltas=[],opts={}){
  const rows=(Array.isArray(candidates)?candidates:[]).map(c=>({...c,evidence:{...(c?.evidence||{})}}));
  const deltas=Array.isArray(financialDeltas)?financialDeltas:[];
  const used=new Set(),ambiguous=[];

  for(const d of deltas){
    if(!d||!Number.isFinite(d.amount)||d.amount<=0)continue;
    if(d.crossStreet===true||!d.street){ambiguous.push({...d,reason:'financial-window-crossed-street'});continue;}
    const matches=[];
    for(let i=0;i<rows.length;i++){
      const c=rows[i];
      if(!c||c.status!=='provisional'||c.sovereign===true)continue;
      if(c?.evidence?.financial)continue;
      if(Number.isFinite(c.amount))continue;
      if(!MONEY_ACTIONS.has(clean(c.action).toUpperCase()))continue;
      if(c.street&&d.street&&c.street!==d.street)continue;
      if(!sameSubject(c,d)||!inWindow(c,d,opts))continue;
      matches.push(i);
    }
    if(matches.length!==1){
      if(matches.length>1)ambiguous.push({...d,reason:'multiple-monetary-actions-in-snapshot-window',candidateIndexes:matches});
      continue;
    }
    const i=matches[0];
    if(used.has(i)){ambiguous.push({...d,reason:'candidate-already-sized',candidateIndexes:[i]});continue;}
    used.add(i);
    const c=rows[i];
    rows[i]={
      ...c,
      amount:Number(d.amount.toFixed(4)),
      sizingConfidence:Math.min(Number.isFinite(c.confidence)?c.confidence:1,Number.isFinite(d.confidence)?d.confidence:1),
      evidence:{
        ...(c.evidence||{}),
        financial:{
          source:d.source||'metadata-stack-delta',
          amount:Number(d.amount.toFixed(4)),
          stackBefore:d.stackBefore??null,
          stackAfter:d.stackAfter??null,
          fromObservedAt:d.fromObservedAt??null,
          capturedAt:d.capturedAt??null,
          confidence:d.confidence??null,
        },
      },
    };
  }
  return {candidates:rows,ambiguous,matched:used.size};
}

export function actionEvidenceSummary(candidates=[],ambiguous=[]){
  const rows=Array.isArray(candidates)?candidates:[];
  return {
    sized:rows.filter(c=>Number.isFinite(c?.amount)&&c?.evidence?.financial).length,
    unsizedMoneyActions:rows.filter(c=>c?.status==='provisional'&&MONEY_ACTIONS.has(clean(c?.action).toUpperCase())&&!Number.isFinite(c?.amount)).length,
    ambiguousFinancial:Array.isArray(ambiguous)?ambiguous.length:0,
  };
}
