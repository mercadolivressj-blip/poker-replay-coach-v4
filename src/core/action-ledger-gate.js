const ACTIONS=new Set(['FOLD','CHECK','CALL','BET','RAISE','ALLIN']);
const MONEY_ACTIONS=new Set(['CALL','BET','RAISE','ALLIN']);
const finite=(v)=>typeof v==='number' && Number.isFinite(v);

/**
 * Final completeness gate for reconstructed seat-state history.
 * Transient PokerStars text may corroborate an event, but it must never be the
 * sole source accepted here.
 */
export function validateActionLedgerV1({events=[],unresolved=0,heroTurnConfirmed=false,expectedHistoryCount=null}={}){
  const errors=[];
  if(!Array.isArray(events)) errors.push('ledger_events_missing');
  const rows=Array.isArray(events)?events:[];
  if(!Number.isInteger(unresolved) || unresolved<0) errors.push('ledger_unresolved_invalid');
  else if(unresolved!==0) errors.push('ledger_unresolved_actions');
  if(heroTurnConfirmed!==true) errors.push('ledger_hero_turn_not_confirmed');
  if(expectedHistoryCount!=null){
    if(!Number.isInteger(expectedHistoryCount) || expectedHistoryCount<0) errors.push('ledger_expected_count_invalid');
    else if(rows.length<expectedHistoryCount) errors.push('ledger_history_short');
  }

  let lastT=-Infinity;
  const ids=new Set();
  for(const e of rows){
    if(!e || typeof e!=='object'){ errors.push('ledger_event_invalid'); continue; }
    const action=String(e.action||'').toUpperCase();
    if(!ACTIONS.has(action)) errors.push('ledger_action_invalid');
    if(typeof e.seat!=='string' || !e.seat) errors.push('ledger_seat_missing');
    if(finite(e.t)){
      if(e.t+1e-9<lastT) errors.push('ledger_time_not_monotonic');
      lastT=Math.max(lastT,e.t);
    }
    if(e.id!=null){
      const key=String(e.id);
      if(ids.has(key)) errors.push('ledger_duplicate_event');
      ids.add(key);
    }
    if(MONEY_ACTIONS.has(action) && (!finite(e.amount) || e.amount<0)) errors.push('ledger_money_missing');
    if(typeof e.source!=='string' || !e.source || e.source==='transient-text-only') errors.push('ledger_source_invalid');
  }

  const unique=[...new Set(errors)];
  return {
    complete:unique.length===0,
    source:'seat-state-ledger-v1',
    errors:unique,
    eventCount:rows.length,
    unresolved:Number.isInteger(unresolved)?unresolved:null,
  };
}
