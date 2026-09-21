const CLOCKWISE=['top','rt','rb','hero','lb','lt'];
const LABELS={
  2:['BTN/SB','BB'],
  3:['BTN','SB','BB'],
  4:['BTN','SB','BB','CO'],
  5:['BTN','SB','BB','UTG','CO'],
  6:['BTN','SB','BB','UTG','HJ','CO'],
};

export function deriveHeroPosition(dealerSeat,dealtSeats,heroSeat='hero'){
  const active=CLOCKWISE.filter((s)=>new Set(dealtSeats||[]).has(s));
  if(!dealerSeat || !active.includes(dealerSeat) || !active.includes(heroSeat)) return null;
  const labels=LABELS[active.length];
  if(!labels) return null;
  const i=active.indexOf(dealerSeat);
  const order=[...active.slice(i),...active.slice(0,i)];
  return labels[order.indexOf(heroSeat)] ?? null;
}

export function createFrozenPositionTracker(heroSeat='hero'){
  let handId=null;
  let snapshot=null;
  return {
    observe({handId:nextHandId,dealerSeat,dealtSeats}={}){
      if(nextHandId==null) return snapshot;
      if(nextHandId===handId) return snapshot;
      const position=deriveHeroPosition(dealerSeat,dealtSeats,heroSeat);
      if(!position) return null;
      handId=nextHandId;
      snapshot={
        handId,
        heroPosition:position,
        dealerSeat,
        dealtSeats:[...(dealtSeats||[])],
        source:'dealer-plus-occupied-seats-only',
      };
      return snapshot;
    },
    current(){ return snapshot; },
    reset(){ handId=null; snapshot=null; },
  };
}
