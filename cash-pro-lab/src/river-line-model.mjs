import {splitCombo} from './cards.mjs';
import {cloneRange,removeDeadCards,reweightRange,normalizedComboProbabilities} from './combo-range.mjs';
import {evaluateSeven} from './holdem-evaluator.mjs';
import {boardSuitState,heroSuitBlockers} from './river-range-audit.mjs';

const RANK_VALUE=Object.freeze(Object.fromEntries([...'23456789TJQKA'].map((r,i)=>[r,i+2])));

export function riverComboFeatures(combo,board=[]){
  if(board.length!==5) throw new Error('river_board_requires_5');
  const cards=splitCombo(combo);
  const hand=evaluateSeven([...cards,...board]);
  const suitState=boardSuitState(board);
  const dominant=suitState.dominantSuit;
  const suitedCards=cards.filter(c=>c[1]===dominant);
  const blockerValues=suitedCards.map(c=>RANK_VALUE[c[0]]).sort((a,b)=>b-a);
  return {
    combo,cards,hand,
    madeName:hand.name,madeTier:hand.tier,
    boardDominantSuit:dominant,
    sameSuitHoleCards:suitedCards.length,
    highCompletedSuitBlocker:blockerValues.some(v=>v>=12),
    aceCompletedSuitBlocker:blockerValues.includes(14),
    weakShowdown:hand.tier<=1,
    mediumShowdown:hand.tier===2,
    strongValue:hand.tier>=3,
    flushOrBetter:hand.tier>=5
  };
}

function largeRiverBetFactor(f,{flushCompleted=false,turnCheckedBack=false}={}){
  let x=1;
  if(f.madeTier>=6) x=1.55;
  else if(f.madeTier===5) x=1.48;
  else if(f.madeTier===4) x=1.10;
  else if(f.madeTier===3) x=.90;
  else if(f.madeTier===2) x=.58;
  else if(f.madeTier===1) x=.38;
  else x=.52;

  if(f.weakShowdown && f.highCompletedSuitBlocker) x*=1.55;
  if(f.weakShowdown && f.aceCompletedSuitBlocker) x*=1.20;
  if(flushCompleted && f.flushOrBetter) x*=1.20;
  if(flushCompleted && f.madeTier===2) x*=.82;
  if(turnCheckedBack && f.flushOrBetter) x*=1.08;
  return x;
}

function mediumRiverBetFactor(f,{flushCompleted=false}={}){
  let x=f.madeTier>=5?1.30:f.madeTier>=3?1.12:f.madeTier===2?.92:f.madeTier===1?.68:.62;
  if(f.weakShowdown&&f.highCompletedSuitBlocker)x*=1.25;
  if(flushCompleted&&f.flushOrBetter)x*=1.10;
  return x;
}

function smallRiverBetFactor(f){
  if(f.madeTier>=5)return 1.05;
  if(f.madeTier>=2)return 1.20;
  if(f.madeTier===1)return .95;
  return .55;
}

function checkRiverFactor(f){
  if(f.madeTier>=5)return .38;
  if(f.madeTier>=3)return .62;
  if(f.madeTier===2)return .90;
  if(f.madeTier===1)return 1.20;
  return 1.05;
}

export function applyRiverActionEvidence(range,{board,hero=[],action='BET',sizePct=0,flushCompleted=false,turnCheckedBack=false}={}){
  const dead=[...hero,...board];
  let live=removeDeadCards(range,dead);
  const a=String(action||'').toUpperCase();
  live=reweightRange(live,({combo})=>{
    const f=riverComboFeatures(combo,board);
    if(a==='CHECK') return checkRiverFactor(f);
    if(a==='RAISE'||a==='ALLIN') return largeRiverBetFactor(f,{flushCompleted,turnCheckedBack})*1.12;
    if(a==='BET'){
      if(sizePct>=75) return largeRiverBetFactor(f,{flushCompleted,turnCheckedBack});
      if(sizePct>=40) return mediumRiverBetFactor(f,{flushCompleted});
      return smallRiverBetFactor(f);
    }
    return 1;
  },{floor:0,ceiling:1});
  return live;
}

export function riverLineSummary(range,{board,hero=[]}={}){
  const probs=normalizedComboProbabilities(removeDeadCards(range,[...hero,...board]));
  const out={flushOrBetter:0,strongValue:0,twoPair:0,pair:0,highCard:0,highSuitBlockerBluffCandidates:0,total:0};
  for(const [combo,p] of probs){
    const f=riverComboFeatures(combo,board);out.total+=p;
    if(f.flushOrBetter)out.flushOrBetter+=p;
    if(f.strongValue)out.strongValue+=p;
    if(f.madeTier===2)out.twoPair+=p;
    if(f.madeTier===1)out.pair+=p;
    if(f.madeTier===0)out.highCard+=p;
    if(f.weakShowdown&&f.highCompletedSuitBlocker)out.highSuitBlockerBluffCandidates+=p;
  }
  return out;
}

export function heroBlockerContext(hero,board){return heroSuitBlockers(hero,board);}
