import { parseMoneyLike } from './seat-identity.js';
import { createActionInferenceState, resetActionInferenceStreet, inferStackDeltaAction } from './action-inference.js';
import { streetFromBoard } from './action-ledger.js';

const clean=(v)=>String(v??'').replace(/\s+/g,' ').trim();
const actorOf=(row)=>clean(row?.name??row?.player??row?.nick??row?.nickname??row?.actor);
const stackOf=(row)=>parseMoneyLike(row?.stack??row?.stackValue??row?.chips??row?.balance??row?.amount);

export function normalizeSeatFinancialSnapshot(seats=[]){
  const out={};
  for(const row of Array.isArray(seats)?seats:[]){
    if(!row||typeof row!=='object')continue;
    const actor=actorOf(row),stack=stackOf(row);
    if(!actor||stack==null||stack<0)continue;
    if(out[actor])continue; // duplicate actor rows are ambiguous; keep first only until caller resolves identity.
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
  return {
    version:'metadata-finance-v1',
    street,
    stacks:{},
    inference:createActionInferenceState({street}),
    observedAt:null,
  };
}

export function resetMetadataFinanceHand(){ return createMetadataFinanceState(); }

export function observeMetadataFinance(stateInput, visionState={}, now=Date.now(), {
  epsilon=.005,
  confidence=.74,
  includeHero=false,
}={}){
  let state=stateInput||createMetadataFinanceState();
  const street=streetFromBoard(visionState.board||[]);
  let inference=state.inference||createActionInferenceState({street});
  if(state.street!==street) inference=resetActionInferenceStreet(inference,street);

  const snapshot=normalizeSeatFinancialSnapshot(visionState.seats||[]);
  const previous={...(state.stacks||{})};
  const nextStacks={...previous};
  const candidates=[];

  for(const row of Object.values(snapshot)){
    const actor=row.actor;
    const prev=Number.isFinite(previous[actor])?previous[actor]:null;
    nextStacks[actor]=row.stack;
    if(prev==null)continue; // first sighting anchors baseline only.
    if(row.stack>prev+epsilon)continue; // payout/rebuy/transition: update baseline, never infer an action.
    const spent=prev-row.stack;
    if(spent<=epsilon)continue;
    if(row.isHero&&!includeHero)continue;

    const out=inferStackDeltaAction(inference,{
      actor,
      stackBefore:prev,
      stackAfter:row.stack,
      at:now,
      confidence,
      allIn:row.stack<=epsilon,
      source:'metadata-stack-delta',
      epsilon,
    });
    inference=out.state;
    if(!out.event)continue;
    candidates.push({
      ...out.event,
      version:'capture-action-candidate-v1',
      handId:null,
      seatId:row.seatId,
      status:'provisional',
      sovereign:false,
      evidence:{
        stackBefore:Number(prev.toFixed(4)),
        stackAfter:Number(row.stack.toFixed(4)),
        spent:Number(spent.toFixed(4)),
        method:'metadata-stack-delta',
      },
    });
  }

  return {
    state:{
      version:'metadata-finance-v1',
      street,
      stacks:nextStacks,
      inference,
      observedAt:now,
    },
    candidates,
    snapshot,
  };
}

export function metadataFinanceSummary(stateInput){
  const s=stateInput||createMetadataFinanceState();
  return {version:s.version,street:s.street,actors:Object.keys(s.stacks||{}).length,stacks:{...(s.stacks||{})},observedAt:s.observedAt??null};
}
