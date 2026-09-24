import {parseCard} from './holdem-evaluator.js';

function straightHigh(values){
 const set=new Set(values);if(set.has(14))set.add(1);
 let run=0,last=null,best=0;
 for(const v of [...set].sort((a,b)=>a-b)){
  run=last!=null&&v===last+1?run+1:1;last=v;if(run>=5)best=v;
 }
 return best===1?5:best;
}
function top(values,n){return [...values].sort((a,b)=>b-a).slice(0,n)}
function cmpTie(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const d=(a[i]||0)-(b[i]||0);if(d)return d}return 0}

export function fastEvaluate(codes){
 if(!Array.isArray(codes)||codes.length<5||codes.length>7)throw new Error('fast_evaluate_requires_5_to_7');
 const cards=codes.map(parseCard);if(new Set(cards.map(c=>c.code)).size!==cards.length)throw new Error('duplicate_card');
 const rankCounts=new Map(),suitRanks=new Map();
 for(const c of cards){rankCounts.set(c.value,(rankCounts.get(c.value)||0)+1);if(!suitRanks.has(c.suit))suitRanks.set(c.suit,[]);suitRanks.get(c.suit).push(c.value)}
 const groups=[...rankCounts.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
 for(const ranks of suitRanks.values())if(ranks.length>=5){const sh=straightHigh(ranks);if(sh)return{tier:8,tie:[sh],name:'straight-flush'}}
 const quads=groups.filter(x=>x[1]===4).map(x=>x[0]);
 if(quads.length){const q=Math.max(...quads),k=top([...rankCounts.keys()].filter(x=>x!==q),1)[0];return{tier:7,tie:[q,k],name:'quads'}}
 const trips=groups.filter(x=>x[1]>=3).map(x=>x[0]).sort((a,b)=>b-a);
 const pairish=groups.filter(x=>x[1]>=2).map(x=>x[0]).sort((a,b)=>b-a);
 if(trips.length){const t=trips[0],p=pairish.find(x=>x!==t);if(p!=null)return{tier:6,tie:[t,p],name:'full-house'}}
 let bestFlush=null;
 for(const ranks of suitRanks.values())if(ranks.length>=5){const f=top(ranks,5);if(!bestFlush||cmpTie(f,bestFlush)>0)bestFlush=f}
 if(bestFlush)return{tier:5,tie:bestFlush,name:'flush'};
 const sh=straightHigh([...rankCounts.keys()]);if(sh)return{tier:4,tie:[sh],name:'straight'};
 if(trips.length){const t=trips[0],k=top([...rankCounts.keys()].filter(x=>x!==t),2);return{tier:3,tie:[t,...k],name:'trips'}}
 const pairs=groups.filter(x=>x[1]===2).map(x=>x[0]).sort((a,b)=>b-a);
 if(pairs.length>=2){const p1=pairs[0],p2=pairs[1],k=top([...rankCounts.keys()].filter(x=>x!==p1&&x!==p2),1)[0];return{tier:2,tie:[p1,p2,k],name:'two-pair'}}
 if(pairs.length===1){const p=pairs[0],k=top([...rankCounts.keys()].filter(x=>x!==p),3);return{tier:1,tie:[p,...k],name:'pair'}}
 return{tier:0,tie:top([...rankCounts.keys()],5),name:'high-card'};
}

export function compareFast(a,b){return a.tier!==b.tier?a.tier-b.tier:cmpTie(a.tie,b.tie)}

export function fastCompareHoldem(hero,villain,board){
 if(hero.length!==2||villain.length!==2||board.length!==5)throw new Error('fast_compare_shape');
 const all=[...hero,...villain,...board].map(parseCard).map(c=>c.code);if(new Set(all).size!==9)throw new Error('duplicate_card');
 const hs=fastEvaluate([...hero,...board]),vs=fastEvaluate([...villain,...board]);
 return{result:Math.sign(compareFast(hs,vs)),hero:hs,villain:vs};
}
