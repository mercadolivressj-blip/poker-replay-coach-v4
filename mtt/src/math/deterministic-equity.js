import {compareHoldem,remainingDeck,parseCard} from './holdem-evaluator.js';
import {expandWeightedRange} from './range-combos.js';

function hashSeed(value){
 let h=2166136261>>>0;for(const ch of String(value??'mtt')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0}return h||1;
}
function rng32(seed){let x=hashSeed(seed);return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296}}
function weightedPicker(items,rand){
 const total=items.reduce((a,x)=>a+x.weight,0);if(!(total>0))throw new Error('weighted_range_zero');
 return()=>{let r=rand()*total;for(const item of items){r-=item.weight;if(r<=0)return item}return items[items.length-1]};
}
function normalizeCards(cards=[]){return cards.map(parseCard).map(x=>x.code)}

export function equityVsWeightedRange({heroCards,villainRange,board=[],iterations=10000,seed='mtt-equity-v1'}){
 const hero=normalizeCards(heroCards),b=normalizeCards(board);
 if(hero.length!==2||b.length>5)throw new Error('equity_range_shape');
 const known=[...hero,...b];if(new Set(known).size!==known.length)throw new Error('duplicate_card');
 const villains=expandWeightedRange(villainRange,{deadCards:known});
 if(!villains.length)throw new Error('villain_range_blocked');
 const n=Math.max(1,Math.floor(Number(iterations)||0)),rand=rng32(seed),pickVillain=weightedPicker(villains,rand);
 let win=0,tie=0,lose=0;
 for(let i=0;i<n;i++){
  const v=pickVillain().cards;
  const dead=[...known,...v],deck=remainingDeck(dead),need=5-b.length,run=[];
  for(let k=0;k<need;k++){
   const j=k+Math.floor(rand()*(deck.length-k));
   [deck[k],deck[j]]=[deck[j],deck[k]];run.push(deck[k]);
  }
  const r=compareHoldem(hero,v,[...b,...run]).result;
  if(r>0)win++;else if(r<0)lose++;else tie++;
 }
 const equity=(win+tie*.5)/n;
 return{win,tie,lose,total:n,equity,equityPct:equity*100,seed:String(seed),iterations:n,villainComboCount:villains.length};
}
