import {splitCombo} from './cards.mjs';
import {removeDeadCards,reweightRange,normalizedComboProbabilities} from './combo-range.mjs';
import {classifyPostflopHand} from './draw-classifier.mjs';

function bucket(action,sizePct){
  const a=String(action||'').toUpperCase();
  if(a==='CHECK')return 'CHECK';
  if(a==='RAISE'||a==='ALLIN')return 'RAISE';
  if(a==='CALL')return 'CALL';
  const x=Number(sizePct)||0;
  if(x<=35)return 'BET_SMALL';
  if(x<=70)return 'BET_MEDIUM';
  return 'BET_LARGE';
}

function madeStrength(f){
  if(f.made.tier>=5)return 'MONSTER';
  if(f.made.tier>=3)return 'VERY_STRONG';
  if(f.made.tier===2)return 'STRONG';
  if(f.made.tier===1)return 'PAIR';
  return 'AIR';
}

const BASE=Object.freeze({
  flop:Object.freeze({
    CHECK:{MONSTER:.62,VERY_STRONG:.66,STRONG:.72,PAIR:.92,AIR:1.00},
    CALL:{MONSTER:.74,VERY_STRONG:.84,STRONG:.92,PAIR:.82,AIR:.30},
    BET_SMALL:{MONSTER:.94,VERY_STRONG:.98,STRONG:.92,PAIR:.76,AIR:.58},
    BET_MEDIUM:{MONSTER:1.00,VERY_STRONG:.98,STRONG:.84,PAIR:.58,AIR:.42},
    BET_LARGE:{MONSTER:1.00,VERY_STRONG:.92,STRONG:.70,PAIR:.38,AIR:.26},
    RAISE:{MONSTER:1.00,VERY_STRONG:.96,STRONG:.68,PAIR:.22,AIR:.20}
  }),
  turn:Object.freeze({
    CHECK:{MONSTER:.52,VERY_STRONG:.60,STRONG:.72,PAIR:.98,AIR:1.00},
    CALL:{MONSTER:.70,VERY_STRONG:.82,STRONG:.94,PAIR:.74,AIR:.22},
    BET_SMALL:{MONSTER:.90,VERY_STRONG:.96,STRONG:.90,PAIR:.68,AIR:.48},
    BET_MEDIUM:{MONSTER:1.00,VERY_STRONG:.98,STRONG:.80,PAIR:.48,AIR:.33},
    BET_LARGE:{MONSTER:1.00,VERY_STRONG:.94,STRONG:.64,PAIR:.30,AIR:.20},
    RAISE:{MONSTER:1.00,VERY_STRONG:.98,STRONG:.60,PAIR:.18,AIR:.16}
  })
});

function evidenceFactor(features,{street,action,sizePct=0}={}){
  const s=String(street).toLowerCase(),k=bucket(action,sizePct),strength=madeStrength(features);
  let x=BASE[s]?.[k]?.[strength];
  if(!Number.isFinite(x))throw new Error(`unsupported_line_evidence:${street}:${action}`);

  const draw=features.flushDraw||features.openEnded||features.doubleGutshot;
  const weakDraw=features.gutshot||features.backdoorFlush||features.overcards>=1;
  if(['BET_SMALL','BET_MEDIUM','BET_LARGE','RAISE'].includes(k)){
    if(draw)x*=1.18;
    else if(weakDraw&&strength==='AIR')x*=1.10;
    if(features.nutFlushDraw)x*=1.10;
    if(features.highFlushBlocker&&strength==='AIR')x*=1.05;
  }
  if(k==='CALL'){
    if(draw)x*=1.22;
    if(features.nutFlushDraw)x*=1.08;
  }
  if(k==='CHECK'&&draw)x*=.92;
  return Math.max(.03,Math.min(1.35,x));
}

export function applyStreetActionEvidence(range,{hero=[],board,street,action,sizePct=0}={}){
  const s=String(street||'').toLowerCase();
  if(!['flop','turn'].includes(s))throw new Error('street_requires_flop_or_turn');
  if((s==='flop'&&board.length!==3)||(s==='turn'&&board.length!==4))throw new Error('board_length_mismatch');
  let live=removeDeadCards(range,[...hero,...board]);
  live=reweightRange(live,({combo})=>{
    const f=classifyPostflopHand(splitCombo(combo),board);
    return evidenceFactor(f,{street:s,action,sizePct});
  },{floor:0,ceiling:1});
  return live;
}

export function streetRangeSummary(range,{hero=[],board}={}){
  const probs=normalizedComboProbabilities(removeDeadCards(range,[...hero,...board]));
  const out={monster:0,veryStrong:0,strong:0,pair:0,air:0,flushDraw:0,openEnded:0,gutshot:0,doubleGutshot:0,nutFlushDraw:0,total:0};
  for(const [combo,p] of probs){
    const f=classifyPostflopHand(splitCombo(combo),board);out.total+=p;
    const m=madeStrength(f);
    if(m==='MONSTER')out.monster+=p;else if(m==='VERY_STRONG')out.veryStrong+=p;else if(m==='STRONG')out.strong+=p;else if(m==='PAIR')out.pair+=p;else out.air+=p;
    if(f.flushDraw)out.flushDraw+=p;if(f.openEnded)out.openEnded+=p;if(f.gutshot)out.gutshot+=p;if(f.doubleGutshot)out.doubleGutshot+=p;if(f.nutFlushDraw)out.nutFlushDraw+=p;
  }
  return out;
}

export function applyPostflopLine(range,{hero=[],flop,turn=null,actions=[]}={}){
  if(!Array.isArray(flop)||flop.length!==3)throw new Error('flop_required');
  let current=range;
  const trace=[];
  for(const row of actions){
    const street=String(row.street||'').toLowerCase();
    const board=street==='flop'?flop:street==='turn'&&turn?[...flop,turn]:null;
    if(!board)throw new Error(`missing_board_for_${street}`);
    current=applyStreetActionEvidence(current,{hero,board,street,action:row.action,sizePct:row.sizePct});
    trace.push({street,action:String(row.action).toUpperCase(),sizePct:Number(row.sizePct||0),summary:streetRangeSummary(current,{hero,board})});
  }
  return {range:current,trace};
}
