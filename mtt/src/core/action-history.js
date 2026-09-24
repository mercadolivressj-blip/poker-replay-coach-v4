const MAP=Object.freeze({
  FOLD:'FOLD',FOLDS:'FOLD',DESISTO:'FOLD',DESISTE:'FOLD',DESISTIU:'FOLD',
  CHECK:'CHECK',CHECKS:'CHECK',PASSO:'CHECK',PASSA:'CHECK',PASSOU:'CHECK',
  CALL:'CALL',CALLS:'CALL',PAGO:'CALL',PAGA:'CALL',PAGOU:'CALL',IGUALO:'CALL',
  BET:'BET',BETS:'BET',APOSTO:'BET',APOSTA:'BET',APOSTOU:'BET',
  RAISE:'RAISE',RAISES:'RAISE',AUMENTO:'RAISE',AUMENTA:'RAISE',AUMENTOU:'RAISE',
  ALLIN:'ALLIN','ALL-IN':'ALLIN',SHOVE:'ALLIN'
});

export function normalizeAction(a){
  if(!a)return null;
  if(typeof a==='string'){
    const p=a.trim().split(/\s+/),raw=(p[1]||p[0]||'').toUpperCase();
    return{actor:p.length>1?p[0]:null,position:null,action:MAP[raw]||raw,amount:null,street:null};
  }
  const raw=String(a.action||a.type||a.verb||'').toUpperCase().replace(/\s+/g,'');
  return{actor:a.actor??a.player??a.position??null,position:a.position??null,action:MAP[raw]||raw,amount:Number.isFinite(Number(a.amount))?Number(a.amount):null,street:a.street?String(a.street).toLowerCase():null};
}

export function normalizeHistory(history=[]){return history.map(normalizeAction).filter(x=>x&&x.action)}

export function preflopPressure(history=[],{heroPosition=null}={}){
  const h=normalizeHistory(history).filter(x=>!x.street||x.street==='preflop');
  const raises=h.filter(x=>['RAISE','ALLIN'].includes(x.action));
  const calls=h.filter(x=>x.action==='CALL');
  const lastAggressor=raises.length?raises.at(-1):null;
  let node=raises.length>=3?'vs_4bet_plus':raises.length===2?'vs_3bet':raises.length===1?(calls.length?'vs_open_multiway':'vs_open'):'unopened';
  const hp=heroPosition?String(heroPosition).toUpperCase():null;
  const lastPos=lastAggressor?.position?String(lastAggressor.position).toUpperCase():null;
  if(hp==='BB'&&raises.length===1&&lastPos==='SB'&&calls.length===0)node='blind_vs_blind';
  if(hp==='SB'&&raises.length===0&&calls.length===0)node='blind_vs_blind';
  return{raiseCount:raises.length,callCount:calls.length,lastAggressor:lastAggressor?.actor??null,lastAggressorPosition:lastPos,node};
}
