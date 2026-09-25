import {splitCombo} from './cards.mjs';
import {removeDeadCards,normalizedComboProbabilities} from './combo-range.mjs';
import {exactEquityVsHand} from './holdem-evaluator.mjs';

export function exactWeightedTurnEquity({hero,board,villainRange}={}){
  if(!Array.isArray(hero)||hero.length!==2)throw new Error('hero_requires_2');
  if(!Array.isArray(board)||board.length!==4)throw new Error('turn_board_requires_4');
  const live=removeDeadCards(villainRange,[...hero,...board]);
  const probs=normalizedComboProbabilities(live);
  let equity=0,win=0,tie=0,lose=0,totalWeight=0;
  const rows=[];
  for(const [combo,p] of probs){
    const villain=splitCombo(combo);
    const e=exactEquityVsHand(hero,villain,board);
    equity+=p*e.equity;
    win+=p*(e.win/e.total);
    tie+=p*(e.tie/e.total);
    lose+=p*(e.lose/e.total);
    totalWeight+=p;
    rows.push({combo,probability:p,equity:e.equity,win:e.win/e.total,tie:e.tie/e.total,lose:e.lose/e.total,runouts:e.total});
  }
  rows.sort((a,b)=>a.equity-b.equity||b.probability-a.probability);
  return {equity,win,tie,lose,totalWeight,liveCombos:live.weights.size,rows};
}

export function turnCallAudit({hero,board,villainRange,potAfterBet,toCall}={}){
  const pot=Number(potAfterBet),call=Number(toCall);
  if(!(pot>=0)||!(call>0))throw new Error('invalid_pot_or_call');
  const eq=exactWeightedTurnEquity({hero,board,villainRange});
  const required=call/(pot+call);
  // EV relative to folding now: win/tie equity receives the final pot after our call, then subtract call.
  const callEv=eq.equity*(pot+call)-call;
  return {action:callEv>0?'CALL':'FOLD',equity:eq.equity,requiredEquity:required,edge:eq.equity-required,callEv,liveCombos:eq.liveCombos};
}
