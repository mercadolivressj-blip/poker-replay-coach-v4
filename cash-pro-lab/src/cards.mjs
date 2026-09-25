export const RANKS='23456789TJQKA';
export const SUITS='cdhs';
const RANK_VALUE=Object.freeze(Object.fromEntries([...RANKS].map((r,i)=>[r,i+2])));

export function normalizeCard(card){
  const s=String(card||'').trim();
  if(s.length!==2) throw new Error(`invalid_card:${card}`);
  const rank=s[0].toUpperCase();
  const suit=s[1].toLowerCase();
  if(!RANKS.includes(rank)||!SUITS.includes(suit)) throw new Error(`invalid_card:${card}`);
  return rank+suit;
}

export function rankValue(card){ return RANK_VALUE[normalizeCard(card)[0]]; }

export function deck52(){
  const out=[];
  for(const r of RANKS) for(const s of SUITS) out.push(r+s);
  return out;
}

function cardSortKey(card){
  const c=normalizeCard(card);
  return rankValue(c)*10 + SUITS.indexOf(c[1]);
}

export function canonicalCombo(a,b){
  a=normalizeCard(a); b=normalizeCard(b);
  if(a===b) throw new Error(`duplicate_card_combo:${a}`);
  return cardSortKey(a)>cardSortKey(b) ? `${a}${b}` : `${b}${a}`;
}

export function splitCombo(combo){
  const s=String(combo||'').trim();
  if(s.length!==4) throw new Error(`invalid_combo:${combo}`);
  const a=normalizeCard(s.slice(0,2));
  const b=normalizeCard(s.slice(2,4));
  if(a===b) throw new Error(`duplicate_card_combo:${a}`);
  return [a,b];
}

export function allTwoCardCombos(){
  const deck=deck52(), out=[];
  for(let i=0;i<deck.length;i++){
    for(let j=i+1;j<deck.length;j++) out.push(canonicalCombo(deck[i],deck[j]));
  }
  return out;
}

export function assertUniqueCards(cards=[]){
  const xs=cards.map(normalizeCard);
  if(new Set(xs).size!==xs.length) throw new Error('duplicate_dead_card');
  return xs;
}

export function comboHasDeadCard(combo,deadCards=[]){
  const dead=new Set(assertUniqueCards(deadCards));
  return splitCombo(combo).some(c=>dead.has(c));
}
