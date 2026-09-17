const clean=(v)=>String(v??'').trim();
const actionRank={FOLD:1,CHECK:2,CALL:3,BET:4,RAISE:5,ALLIN:6};

function rowKey(c){
  if(c?.packetId)return `packet:${c.packetId}`;
  return [c?.handId??'?',c?.street??'preflop',c?.seatId??'?',c?.actor??'?',c?.action??'?',Math.round((Number(c?.capturedAt)||0)/350)].join('|');
}

export function buildObservedLedger(candidates=[], {handId=null}={}){
  const seen=new Set(),actions=[];
  for(const c of (Array.isArray(candidates)?candidates:[])){
    if(!c||c.status==='rejected'||c.sovereign===true)continue;
    const action=clean(c.action).toUpperCase();
    if(!actionRank[action])continue;
    const key=rowKey(c); if(seen.has(key))continue; seen.add(key);
    actions.push({
      seq:0,
      handId:c.handId??handId,
      street:clean(c.street)||'preflop',
      seatId:clean(c.seatId)||null,
      actor:clean(c.actor)||null,
      action,
      amount:Number.isFinite(c.amount)?c.amount:null,
      totalCommitted:Number.isFinite(c.totalCommitted)?c.totalCommitted:null,
      capturedAt:Number(c.capturedAt)||0,
      confidence:Number.isFinite(c.confidence)?c.confidence:null,
      source:clean(c.source)||'local-capture',
      status:'provisional',
      sovereign:false,
    });
  }
  actions.sort((a,b)=>(a.capturedAt||0)-(b.capturedAt||0)||actionRank[a.action]-actionRank[b.action]);
  actions.forEach((a,i)=>{a.seq=i+1});
  const playersSeen=[...new Set(actions.map(a=>a.actor).filter(Boolean))];
  return {version:'observed-ledger-v1',handId,actions,playersSeen,sovereign:false};
}

export function observedLedgerSummary(ledger){
  const l=ledger||buildObservedLedger();
  return {
    version:l.version,
    handId:l.handId??null,
    count:l.actions?.length??0,
    playersSeen:l.playersSeen??[],
    actions:(l.actions||[]).slice(-20).map(a=>({
      seq:a.seq,street:a.street,seatId:a.seatId,actor:a.actor,action:a.action,
      amount:a.amount,confidence:a.confidence,source:a.source,status:'provisional',sovereign:false,
    })),
  };
}
