import {exactWeightedRiverEquity} from './river-range-audit.mjs';

export function riverCallAudit({hero,board,villainRange,potAfterBet,toCall}){
  const pot=Number(potAfterBet),call=Number(toCall);
  if(!(pot>=0)||!(call>0)) throw new Error('invalid_pot_or_call');
  const eq=exactWeightedRiverEquity({hero,board,villainRange});
  const required=call/(pot+call);
  const callEv=eq.equity*(pot+call)-call;
  return {
    action:callEv>0?'CALL':'FOLD',
    equity:eq.equity,
    requiredEquity:required,
    edge:eq.equity-required,
    callEv,
    potAfterBet:pot,
    toCall:call,
    liveCombos:eq.liveCombos,
    win:eq.win,tie:eq.tie,lose:eq.lose
  };
}

export function aggressionDisagreementGate({selectedAction,callAudit,independentAction=null,rangeStatus='lab-only'}={}){
  const selected=String(selectedAction||'').toUpperCase();
  const independent=String(independentAction||callAudit?.action||'').toUpperCase();
  const aggressive=['RAISE','ALLIN'].includes(selected);
  const reasons=[];
  if(aggressive && independent && independent!==selected) reasons.push('independent_ev_disagrees_with_aggression');
  if(aggressive && rangeStatus!=='certified') reasons.push('range_not_certified_for_aggressive_override');
  return {allowed:reasons.length===0,reasons,selected,independent,rangeStatus};
}
