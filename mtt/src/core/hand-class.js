const RANKS='23456789TJQKA';
const SUITS='cdhs';

function card(x){
 const s=String(x||'').trim(); if(s.length!==2)return null;
 const r=s[0].toUpperCase(),u=s[1].toLowerCase();
 return RANKS.includes(r)&&SUITS.includes(u)?{r,u}:null;
}

export function normalizeHandClass(input){
 const raw=String(input||'').replace(/\s+/g,'');
 if(/^[2-9TJQKA]{2}[so]$/i.test(raw)||/^[2-9TJQKA]{2}$/i.test(raw)){
  const a=raw[0].toUpperCase(),b=raw[1].toUpperCase(),suffix=raw[2]?.toLowerCase()||'';
  if(a===b)return a+a;
  return RANKS.indexOf(a)>RANKS.indexOf(b)?a+b+suffix:b+a+suffix;
 }
 const m=raw.match(/^([2-9TJQKA][cdhs])([2-9TJQKA][cdhs])$/i); if(!m)return null;
 const a=card(m[1]),b=card(m[2]); if(!a||!b||m[1].toLowerCase()===m[2].toLowerCase())return null;
 if(a.r===b.r)return a.r+a.r;
 const hi=RANKS.indexOf(a.r)>RANKS.indexOf(b.r)?a:b,lo=hi===a?b:a;
 return hi.r+lo.r+(a.u===b.u?'s':'o');
}

export function all169(){
 const out=[];
 for(let i=RANKS.length-1;i>=0;i--)for(let j=RANKS.length-1;j>=0;j--){
  const a=RANKS[i],b=RANKS[j];
  if(i===j)out.push(a+b); else if(i>j)out.push(a+b+'s'); else out.push(b+a+'o');
 }
 return [...new Set(out)];
}
