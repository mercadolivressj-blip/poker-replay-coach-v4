import {RANKS,SUITS,canonicalCombo,rankValue} from './cards.mjs';

function rankOrder(r){ return RANKS.indexOf(r); }

export function normalizeHandClass(handClass){
  const raw=String(handClass||'').trim().toUpperCase();
  const m=raw.match(/^([2-9TJQKA])([2-9TJQKA])([SO])?$/);
  if(!m) throw new Error(`invalid_hand_class:${handClass}`);
  let [,a,b,suffixRaw]=m;
  let suffix=suffixRaw?.toLowerCase()||'';
  if(a===b){
    if(suffix) throw new Error(`pair_cannot_have_suitedness:${handClass}`);
    return a+a;
  }
  if(!suffix) throw new Error(`nonpair_requires_s_or_o:${handClass}`);
  if(rankOrder(b)>rankOrder(a)) [a,b]=[b,a];
  return a+b+suffix;
}

export function expandHandClass(handClass){
  const hc=normalizeHandClass(handClass);
  const a=hc[0], b=hc[1], suffix=hc[2]||'';
  const out=[];
  if(a===b){
    for(let i=0;i<SUITS.length;i++){
      for(let j=i+1;j<SUITS.length;j++) out.push(canonicalCombo(a+SUITS[i],b+SUITS[j]));
    }
  } else if(suffix==='s'){
    for(const s of SUITS) out.push(canonicalCombo(a+s,b+s));
  } else {
    for(const sa of SUITS){
      for(const sb of SUITS){
        if(sa===sb) continue;
        out.push(canonicalCombo(a+sa,b+sb));
      }
    }
  }
  return [...new Set(out)].sort();
}

export function all169HandClasses(){
  const desc=[...RANKS].reverse();
  const out=[];
  for(let i=0;i<desc.length;i++){
    for(let j=0;j<desc.length;j++){
      if(i===j) out.push(desc[i]+desc[j]);
      else if(i<j) out.push(desc[i]+desc[j]+'s');
      else out.push(desc[j]+desc[i]+'o');
    }
  }
  return [...new Set(out)];
}

export function comboCountForClass(handClass){ return expandHandClass(handClass).length; }

export function handClassFromCards(cardA,cardB){
  const a=String(cardA),b=String(cardB);
  const ra=a[0].toUpperCase(), rb=b[0].toUpperCase();
  if(ra===rb) return ra+rb;
  const suited=a[1].toLowerCase()===b[1].toLowerCase()?'s':'o';
  return rankValue(a)>=rankValue(b) ? ra+rb+suited : rb+ra+suited;
}
