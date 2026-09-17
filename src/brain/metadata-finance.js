import { parseMoneyLike } from './seat-identity.js';
import { streetFromBoard } from './action-ledger.js';

const clean=(v)=>String(v??'').replace(/\s+/g,' ').trim();
const actorOf=(row)=>clean(row?.name??row?.player??row?.nick??row?.nickname??row?.actor);
const stackOf=(row)=>parseMoneyLike(row?.stack??row?.stackValue??row?.chips??row?.balance);

export function normalizeSeatFinancialSnapshot(seats=[]){
  const out={};
  for(const row of Array.isArray(seats)?seats:[]){
    if(!row||typeof row!=='object')continue;
    const actor=actorOf(row),stack=stackOf(row);
    if(!actor||stack==null||stack<0)continue;
    if(out[actor])continue;
    out[actor]={
      actor,
      stack,
      isHero:row.isHero===true,
      seatId:clean(row.captureSeatId??row.visualSeat??row.visualSlot??row.slot??row.seatId)||null,
    };
  }
  return out;
}

export function createMetadataFinanceState({street='preflop'}={}){
  return {version:'metadata-finance-v1',street,stacks:{},observedAt:null,deltas:[]};
}

export function resetMetadataFinanceHand(){ return createMetadataFinanceState(); }

function materiallyChanged(previous,snapshot,epsilon){
  const keys=Object.keys(snapshot);
  if(!keys.length)return false;
  if(!Object.keys(previous||{}).length)return true;
  for(const actor of keys){
    if(!Number.isFinite(previous?.[actor]))return true;
    if(Math.abs(previous[actor]-snapshot[actor].stack)>epsilon)return true;
  }
  return false;
}

export function observeMetadataFinance(stateInput, visionState={}, now=Date.now(), {
  epsilon=.005,
  confidence=.78,
  includeHero=false,
  forceFresh=false,
}={}){
  const state=stateInput||createMetadataFinanceState();
  const observedAt=Number(state.observedAt)||null;
  if(observedAt!=null&&Number(now)<=observedAt)return {state,deltas:[],snapshot:normalizeSeatFinancialSnapshot(visionState.seats||[]),fresh:false,stale:true};
  const street=streetFromBoard(visionState.board||[]);
  const snapshot=normalizeSeatFinancialSnapshot(visionState.seats||[]);
  const previous={...(state.stacks||{})};
  const changed=materiallyChanged(previous,snapshot,epsilon);
  if(!changed&&!forceFresh){
    // Important: do not advance the financial street from a stale cached seat snapshot.
    return {state,deltas:[],snapshot,fresh:false};
  }
  if(!Object.keys(snapshot).length){
    return {state,deltas:[],snapshot,fresh:false};
  }

  const nextStacks={...previous};
  const deltas=[];
  const fromObservedAt=Number(state.observedAt)||null;
  const crossStreet=Boolean(state.observedAt!=null&&state.street!==street);

  for(const row of Object.values(snapshot)){
    const actor=row.actor;
    const prev=Number.isFinite(previous[actor])?previous[actor]:null;
    nextStacks[actor]=row.stack;
    if(prev==null)continue;
    if(row.stack>prev+epsilon)continue;
    const spent=prev-row.stack;
    if(spent<=epsilon)continue;
    if(row.isHero&&!includeHero)continue;
    deltas.push({
      version:'metadata-finance-v1',
      type:'financial-delta',
      source:'metadata-stack-delta',
      actor,
      seatId:row.seatId,
      street:crossStreet?null:street,
      crossStreet,
      amount:Number(spent.toFixed(4)),
      stackBefore:Number(prev.toFixed(4)),
      stackAfter:Number(row.stack.toFixed(4)),
      allIn:row.stack<=epsilon,
      confidence:Math.max(0,Math.min(1,Number(confidence)||0)),
      fromObservedAt,
      capturedAt:now,
      sovereign:false,
      status:'provisional',
    });
  }

  const history=[...(Array.isArray(state.deltas)?state.deltas:[]),...deltas].slice(-80);
  return {
    state:{version:'metadata-finance-v1',street,stacks:nextStacks,observedAt:now,deltas:history},
    deltas,
    snapshot,
    fresh:true,
  };
}

export function metadataFinanceSummary(stateInput){
  const s=stateInput||createMetadataFinanceState();
  return {version:s.version,street:s.street,actors:Object.keys(s.stacks||{}).length,stacks:{...(s.stacks||{})},recentDeltas:(s.deltas||[]).slice(-20),observedAt:s.observedAt??null};
}
