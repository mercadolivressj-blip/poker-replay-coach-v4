const ids=(seats=[])=>Array.from(new Set((Array.isArray(seats)?seats:[]).map(s=>String(s?.id||'').trim()).filter(Boolean)));

export function createActionSeatState(seats=[]){
  return {version:'action-seat-state-v1',handSeq:0,seats:Object.fromEntries(ids(seats).map(id=>[id,{seenCards:false,folded:false,lastSeenCardsAt:null,foldedAt:null}]))};
}

function ensure(state,id){
  return state.seats?.[id]||{seenCards:false,folded:false,lastSeenCardsAt:null,foldedAt:null};
}

export function observeSeatCardState(stateInput,captureState,now=Date.now()){
  const state=stateInput||createActionSeatState();
  const next={...state,seats:{...(state.seats||{})}};
  for(const [id,row] of Object.entries(captureState?.seats||{})){
    const prev=ensure(next,id);
    if(row?.cardPresent===true){
      next.seats[id]={...prev,seenCards:true,lastSeenCardsAt:now};
    } else if(!next.seats[id]) next.seats[id]=prev;
  }
  return next;
}

export function applyActionSeatEvents(stateInput,events=[],now=Date.now()){
  let next={...(stateInput||createActionSeatState()),seats:{...((stateInput||{}).seats||{})}};
  for(const e of Array.isArray(events)?events:[]){
    if(e?.type==='table-transition'){
      const known=Object.keys(next.seats||{});
      next=createActionSeatState(known.map(id=>({id})));
      next.handSeq=(Number(stateInput?.handSeq)||0)+1;
      continue;
    }
    if(e?.type==='fold-candidate' && e?.seatId && e.seatId!=='hero' && e.seatId!=='table'){
      const id=String(e.seatId),prev=ensure(next,id);
      next.seats[id]={...prev,folded:true,foldedAt:Number(e.at)||now};
    }
  }
  return next;
}

export function actionSeatEligibility(stateInput,seatId){
  const row=stateInput?.seats?.[seatId];
  if(!row?.seenCards)return {eligible:false,reason:'seat-never-seen-with-cards'};
  if(row.folded)return {eligible:false,reason:'seat-already-folded'};
  return {eligible:true,reason:'active-this-hand'};
}

export function actionSeatStateSummary(stateInput){
  const rows=Object.entries(stateInput?.seats||{});
  return {active:rows.filter(([,r])=>r?.seenCards&&!r?.folded).map(([id])=>id),folded:rows.filter(([,r])=>r?.folded).map(([id])=>id),unseen:rows.filter(([,r])=>!r?.seenCards).map(([id])=>id)};
}
