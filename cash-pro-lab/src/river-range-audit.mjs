import {splitCombo} from './cards.mjs';
import {removeDeadCards,normalizedComboProbabilities} from './combo-range.mjs';
import {evaluateSeven,compareHoldem,compareScores} from './holdem-evaluator.mjs';

export function boardSuitState(board=[]){
  const suits={c:0,d:0,h:0,s:0};
  for(const c of board){const s=String(c)[1]?.toLowerCase();if(suits[s]!=null)suits[s]++;}
  const dominant=Object.entries(suits).sort((a,b)=>b[1]-a[1])[0];
  return {counts:suits,dominantSuit:dominant?.[0]||null,maxSuit:dominant?.[1]||0,threeFlush:(dominant?.[1]||0)>=3,fourFlush:(dominant?.[1]||0)>=4};
}

export function drawCompletion(previousBoard=[],board=[]){
  const prev=boardSuitState(previousBoard),now=boardSuitState(board);
  return {
    flushCompleted:prev.maxSuit<3 && now.maxSuit>=3,
    fourFlushArrived:prev.maxSuit<4 && now.maxSuit>=4,
    dominantSuit:now.dominantSuit
  };
}

export function heroSuitBlockers(hero=[],board=[]){
  const suit=boardSuitState(board).dominantSuit;
  const same=hero.filter(c=>String(c)[1]?.toLowerCase()===suit);
  const values=same.map(c=>'23456789TJQKA'.indexOf(String(c)[0].toUpperCase())+2).sort((a,b)=>b-a);
  return {
    suit,
    count:same.length,
    ranks:same.map(c=>String(c)[0].toUpperCase()),
    highestValue:values[0]||0,
    nutFlushBlocker:values.includes(14),
    highFlushBlocker:values.some(v=>v>=12)
  };
}

export function exactWeightedRiverEquity({hero,board,villainRange}){
  if(!Array.isArray(hero)||hero.length!==2) throw new Error('hero_requires_2');
  if(!Array.isArray(board)||board.length!==5) throw new Error('river_board_requires_5');
  const live=removeDeadCards(villainRange,[...hero,...board]);
  const probs=normalizedComboProbabilities(live);
  let win=0,tie=0,lose=0,totalWeight=0;
  const rows=[];
  for(const [combo,p] of probs){
    const villain=splitCombo(combo);
    const cmp=compareHoldem(hero,villain,board);
    totalWeight+=p;
    if(cmp.result>0)win+=p;else if(cmp.result<0)lose+=p;else tie+=p;
    rows.push({combo,probability:p,result:cmp.result,villainHand:cmp.villain.name,villainScore:cmp.villain});
  }
  rows.sort((a,b)=>compareScores(b.villainScore,a.villainScore)||b.probability-a.probability);
  return {equity:win+tie*.5,win,tie,lose,totalWeight,liveCombos:live.weights.size,rows};
}

export function rankVillainCombosByShowdown({board,villainRange,deadCards=[]}){
  if(!Array.isArray(board)||board.length!==5) throw new Error('river_board_requires_5');
  const live=removeDeadCards(villainRange,[...deadCards,...board]);
  const rows=[];
  for(const [combo,weight] of live.weights){
    const hand=evaluateSeven([...splitCombo(combo),...board]);
    rows.push({combo,weight,hand});
  }
  rows.sort((a,b)=>compareScores(b.hand,a.hand));
  let total=rows.reduce((a,x)=>a+x.weight,0),seen=0;
  for(const row of rows){
    const mid=seen+row.weight*.5;
    row.strengthPercentile=total?1-mid/total:0;
    row.band=row.strengthPercentile>=.97?'NUTS':row.strengthPercentile>=.78?'STRONG_VALUE':row.strengthPercentile>=.35?'MEDIUM_SHOWDOWN':'WEAK_SHOWDOWN';
    seen+=row.weight;
  }
  return {rows,totalWeight:total};
}

export function summarizeMadeHands(audit){
  const out={};let total=0;
  for(const r of audit.rows){out[r.villainHand]=(out[r.villainHand]||0)+r.probability;total+=r.probability;}
  return {total,...out};
}
