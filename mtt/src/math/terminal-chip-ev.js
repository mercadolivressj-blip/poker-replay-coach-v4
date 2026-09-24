const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

export function chipEvCallThreshold({potBeforeCall,callCost}){
 const pot=Number(potBeforeCall),call=Number(callCost);
 if(!Number.isFinite(pot)||pot<0||!Number.isFinite(call)||call<0)throw new Error('chip_ev_bad_price');
 const denom=pot+call;
 const required=denom>0?call/denom:1;
 return{equityRequired:required,equityRequiredPct:required*100,potBeforeCall:pot,callCost:call};
}

export function chipEvCall({potBeforeCall,callCost,equity}){
 const t=chipEvCallThreshold({potBeforeCall,callCost}),e=clamp(Number(equity),0,1);
 if(!Number.isFinite(Number(equity)))throw new Error('chip_ev_bad_equity');
 const ev=e*(t.potBeforeCall+t.callCost)-t.callCost;
 return{...t,equity:e,equityPct:e*100,evChips:ev,profitable:ev>=-1e-12,edgePct:(e-t.equityRequired)*100};
}

export function chipEvJam({potBeforeJam,heroJam,opponentCall,foldProbability,equityWhenCalled}){
 const pot=Number(potBeforeJam),hero=Number(heroJam),opp=Number(opponentCall),fp=clamp(Number(foldProbability),0,1),eq=clamp(Number(equityWhenCalled),0,1);
 if(![pot,hero,opp,Number(foldProbability),Number(equityWhenCalled)].every(Number.isFinite)||pot<0||hero<0||opp<0)throw new Error('chip_ev_bad_jam_model');
 // Incremental EV relative to folding now: if villain folds, hero wins existing pot.
 // If called, hero risks heroJam to contest existing pot + both players' added chips.
 const calledPot=pot+hero+opp;
 const evCalled=eq*calledPot-hero;
 const ev=fp*pot+(1-fp)*evCalled;
 return{potBeforeJam:pot,heroJam:hero,opponentCall:opp,foldProbability:fp,equityWhenCalled:eq,evCalledChips:evCalled,evChips:ev,profitable:ev>=-1e-12};
}
