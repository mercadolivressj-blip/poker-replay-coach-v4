const clean=(v)=>String(v??'').replace(/\s+/g,' ').trim();

const ACTION_MAP=Object.freeze({
  FOLD:'FOLD',FOLDS:'FOLD',DESISTO:'FOLD',DESISTE:'FOLD',DESISTIU:'FOLD',
  CHECK:'CHECK',CHECKS:'CHECK',PASSO:'CHECK',PASSA:'CHECK',PASSOU:'CHECK',
  CALL:'CALL',CALLS:'CALL',PAGO:'CALL',PAGA:'CALL',PAGOU:'CALL',IGUALO:'CALL',IGUALA:'CALL',IGUALOU:'CALL',
  BET:'BET',BETS:'BET',APOSTO:'BET',APOSTA:'BET',APOSTOU:'BET',
  RAISE:'RAISE',RAISES:'RAISE',AUMENTO:'RAISE',AUMENTA:'RAISE',AUMENTOU:'RAISE','3BET':'RAISE','3-BET':'RAISE',
  ALLIN:'ALLIN','ALL-IN':'ALLIN',SHOVE:'ALLIN'
});

const first=(obj,keys)=>{for(const k of keys){const v=obj?.[k];if(v!=null&&clean(v))return clean(v)}return ''};

export function actionHistoryEntryText(entry){
  if(typeof entry==='string')return clean(entry);
  if(!entry||typeof entry!=='object'||Array.isArray(entry))return '';
  const raw=first(entry,['raw','text','line','description']);
  const pos=first(entry,['position','pos','actorPosition','seatPosition']);
  const actor=first(entry,['actor','player','name','nick','nickname','seatId','seat']);
  const actionRaw=first(entry,['action','verb','move','type']).toUpperCase().replace(/\s+/g,'');
  const action=ACTION_MAP[actionRaw]||actionRaw;
  const amount=entry.amount??entry.toAmount??entry.value??entry.bet??entry.raiseTo??null;
  const structured=[pos,actor,action,amount!=null?clean(amount):''].filter(Boolean).join(' ');
  if(structured&&/(FOLD|CHECK|CALL|BET|RAISE|ALLIN)/i.test(structured))return structured;
  return raw;
}

export function normalizeActionHistoryEntries(history,{limit=120}={}){
  if(!Array.isArray(history))return [];
  return history.map(actionHistoryEntryText).map(clean).filter(Boolean).slice(-Math.max(1,Number(limit)||120));
}
