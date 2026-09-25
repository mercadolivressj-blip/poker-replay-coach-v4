import {parseCard,evaluateSeven} from './holdem-evaluator.mjs';

const RANKS='23456789TJQKA';
const valueOf=r=>RANKS.indexOf(String(r).toUpperCase())+2;

function uniqueCards(cards){
  const xs=cards.map(parseCard).map(x=>x.code);
  if(new Set(xs).size!==xs.length) throw new Error('duplicate_card');
  return xs;
}

function straightHighFromRanks(values){
  const set=new Set(values);
  if(set.has(14)) set.add(1);
  let run=0,last=null,best=0;
  for(const v of [...set].sort((a,b)=>a-b)){
    run=last!=null&&v===last+1?run+1:1;
    last=v;
    if(run>=5) best=v;
  }
  return best;
}

function completionRanks(values){
  if(straightHighFromRanks(values)) return [];
  const out=[];
  for(let r=2;r<=14;r++){
    if(values.includes(r)) continue;
    if(straightHighFromRanks([...values,r])) out.push(r);
  }
  return out;
}

function classicalOpenEnded(values){
  const set=new Set(values);
  for(let low=3;low<=10;low++){
    const four=[low,low+1,low+2,low+3];
    if(four.every(v=>set.has(v))){
      const below=low-1,above=low+4;
      if(below>=2&&above<=14&&!set.has(below)&&!set.has(above)) return true;
    }
  }
  return false;
}

export function classifyPostflopHand(hole=[],board=[]){
  if(!Array.isArray(hole)||hole.length!==2) throw new Error('hole_requires_2');
  if(!Array.isArray(board)||![3,4].includes(board.length)) throw new Error('board_requires_flop_or_turn');
  const all=uniqueCards([...hole,...board]);
  const hero=hole.map(parseCard),b=board.map(parseCard);
  const made=evaluateSeven(all);
  const madeStraightOrBetter=made.tier>=4;
  const madeFlushOrBetter=made.tier>=5;

  const suitTotals={c:0,d:0,h:0,s:0};
  const heroSuit={c:0,d:0,h:0,s:0};
  const boardSuit={c:0,d:0,h:0,s:0};
  for(const c of hero){suitTotals[c.suit]++;heroSuit[c.suit]++;}
  for(const c of b){suitTotals[c.suit]++;boardSuit[c.suit]++;}
  const dominant=Object.entries(suitTotals).sort((a,b)=>b[1]-a[1])[0];
  const drawSuit=dominant?.[0]||null;
  const maxSuit=dominant?.[1]||0;
  const flushDraw=!madeFlushOrBetter && maxSuit===4 && heroSuit[drawSuit]>0;
  const backdoorFlush=board.length===3 && !madeFlushOrBetter && !flushDraw && maxSuit===3 && heroSuit[drawSuit]>0;
  const heroDrawValues=hero.filter(c=>c.suit===drawSuit).map(c=>c.value);
  const nutFlushDraw=flushDraw && heroDrawValues.includes(14);
  const highFlushDraw=flushDraw && heroDrawValues.some(v=>v>=12);

  const values=[...new Set([...hero,...b].map(c=>c.value))];
  const outs=madeStraightOrBetter?[]:completionRanks(values);
  const openEnded=!madeStraightOrBetter && classicalOpenEnded(values);
  const doubleGutshot=!madeStraightOrBetter && !openEnded && outs.length>=2;
  const gutshot=!madeStraightOrBetter && !openEnded && !doubleGutshot && outs.length===1;
  const boardHigh=Math.max(...b.map(c=>c.value));
  const overcards=hero.filter(c=>c.value>boardHigh).length;

  const boardDominant=Object.entries(boardSuit).sort((a,b)=>b[1]-a[1])[0];
  const blockerSuit=boardDominant?.[0]||null;
  const blockerHero=hero.filter(c=>c.suit===blockerSuit);
  const nutFlushBlocker=Boolean(blockerHero.find(c=>c.value===14) && (boardDominant?.[1]||0)>=2);
  const highFlushBlocker=Boolean(blockerHero.find(c=>c.value>=12) && (boardDominant?.[1]||0)>=2);

  return {
    street:board.length===3?'flop':'turn',
    made,
    pairOrBetter:made.tier>=1,
    twoPairOrBetter:made.tier>=2,
    tripsOrBetter:made.tier>=3,
    madeStraightOrBetter,
    madeFlushOrBetter,
    flushDraw,backdoorFlush,nutFlushDraw,highFlushDraw,drawSuit,
    openEnded,gutshot,doubleGutshot,straightCompletionRanks:outs,
    overcards,
    nutFlushBlocker,highFlushBlocker,blockerSuit,
    drawScore:(flushDraw?3:0)+(openEnded?3:0)+(doubleGutshot?3:0)+(gutshot?1.5:0)+(backdoorFlush?.5:0)+(overcards*.35)
  };
}
