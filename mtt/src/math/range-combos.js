import {normalizeHandClass} from '../core/hand-class.js';

const SUITS='cdhs';
const RANKS='23456789TJQKA';
const card=(r,s)=>r+s;

export function combosForClass(input){
 const h=normalizeHandClass(input);
 if(!h)throw new Error(`bad_hand_class:${input}`);
 const a=h[0],b=h[1],suffix=h[2]||'';
 const out=[];
 if(a===b){
  for(let i=0;i<SUITS.length;i++)for(let j=i+1;j<SUITS.length;j++)out.push([card(a,SUITS[i]),card(b,SUITS[j])]);
 }else if(suffix==='s'){
  for(const s of SUITS)out.push([card(a,s),card(b,s)]);
 }else if(suffix==='o'){
  for(const sa of SUITS)for(const sb of SUITS)if(sa!==sb)out.push([card(a,sa),card(b,sb)]);
 }else throw new Error(`hand_class_suffix_required:${h}`);
 return out;
}

export function comboCountForClass(input){return combosForClass(input).length}

export function canonicalComboKey(combo){
 if(!Array.isArray(combo)||combo.length!==2)throw new Error('combo_requires_2_cards');
 return [...combo].sort().join('');
}

export function normalizeWeightedRange(range){
 const rows=[];
 if(Array.isArray(range)){
  for(const item of range){
   if(typeof item==='string')rows.push({hand:item,weight:1});
   else if(item&&typeof item==='object')rows.push({hand:item.hand??item.class,weight:Number(item.weight??1)});
  }
 }else if(range&&typeof range==='object'){
  for(const [hand,weight] of Object.entries(range))rows.push({hand,weight:Number(weight)});
 }else throw new Error('range_shape_invalid');
 const out=[];
 for(const row of rows){
  const h=normalizeHandClass(row.hand),w=Number(row.weight);
  if(!h||!Number.isFinite(w)||w<=0)continue;
  out.push({hand:h,weight:w});
 }
 if(!out.length)throw new Error('range_empty');
 return out;
}

export function expandWeightedRange(range,{deadCards=[]}={}){
 const dead=new Set(deadCards.map(x=>String(x).trim()));
 const out=[];
 for(const row of normalizeWeightedRange(range)){
  for(const combo of combosForClass(row.hand)){
   if(combo.some(c=>dead.has(c)))continue;
   out.push({hand:row.hand,cards:combo,weight:row.weight});
  }
 }
 return out;
}

export function handClassComboCountSanity(){
 const sample={AA:6,AKs:4,AKo:12};
 return Object.fromEntries(Object.entries(sample).map(([h])=>[h,comboCountForClass(h)]));
}
