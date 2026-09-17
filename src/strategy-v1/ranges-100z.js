import { BASELINE_META, RFI_100Z, VS_RFI_100Z } from './ranges-100z.data.js';

export { BASELINE_META };
export const BASELINE_VERSION = BASELINE_META.version;
const ACTIONS=['fold','call','raise','limp'];
const ALL_FOLD=Object.freeze({fold:100,call:0,raise:0,limp:0});

export function normalizePosition(value){
  if(!value)return null;const v=String(value).trim().toUpperCase();
  return ({UTG:'UTG',EP:'UTG',MP:'HJ',HJ:'HJ',LJ:'UTG',CO:'CO',BTN:'BTN',BU:'BTN',BUTTON:'BTN',SB:'SB',BB:'BB'})[v]||null;
}

const ORDER='23456789TJQKA';
const idx=(r)=>ORDER.indexOf(String(r||'').toUpperCase());
export function handCode(cards){
  if(!Array.isArray(cards)||cards.length!==2)return null;const a=String(cards[0]).trim(),b=String(cards[1]).trim();
  const r1=a[0]?.toUpperCase()||'',r2=b[0]?.toUpperCase()||'';if(idx(r1)<0||idx(r2)<0)return null;
  const suited=a.slice(1).toLowerCase()===b.slice(1).toLowerCase()&&a.length>1;
  if(r1===r2)return `${r1}${r1}`;const hi=idx(r1)>idx(r2)?r1:r2,lo=hi===r1?r2:r1;return `${hi}${lo}${suited?'s':'o'}`;
}

function parseChart(encoded){
  const map=new Map();
  for(const part of String(encoded||'').split(',')){
    if(!part)continue;const [hand,freqs]=part.split('=');const [call,raise,limp]=String(freqs||'').split('/').map(n=>Number(n)||0);
    map.set(hand,{fold:Math.max(0,100-call-raise-limp),call,raise,limp});
  }
  return map;
}
const RFI_CHARTS=new Map(Object.entries(RFI_100Z).map(([k,v])=>[k,parseChart(v)]));
const VS_CHARTS=new Map(Object.entries(VS_RFI_100Z).map(([k,v])=>[k,parseChart(v)]));
export const baselineRfiPositions=()=>[...RFI_CHARTS.keys()];
export const baselineVsNodes=()=>[...VS_CHARTS.keys()];
export const baselineChart=(key)=>RFI_CHARTS.get(key)||VS_CHARTS.get(key)||null;
const mixed=(d)=>ACTIONS.filter(k=>d[k]>0).length>1;

export function lookupBaseline({hand,position,versus=null,node}){
  const chart=node==='rfi'?RFI_CHARTS.get(position):(versus?VS_CHARTS.get(`${position}:${versus}`):null);
  if(!chart)return null;const distribution=chart.get(hand)||ALL_FOLD;
  return {hand,node,position,versus:node==='rfi'?null:versus,distribution,mixed:mixed(distribution),frequencyModel:BASELINE_META.frequencyModel};
}

export function classifyPreflopNode(actionHistory){
  const entries=(actionHistory||[]).map(x=>String(x).toUpperCase().trim()).filter(Boolean);
  if(!entries.length)return {node:'unknown',versus:null,reason:'Sem histórico de ações.'};
  const RAISE=/(RAISE|AUMENT|3-?BET|4-?BET|RERAISE)/,CALL=/(CALL|PAGA|LIMP|IGUAL)/,ALLIN=/(ALL-?IN|ALLIN|TUDO)/;
  let raises=0,calls=0,lastRaiser=null;
  for(const e of entries){
    if(RAISE.test(e)||ALLIN.test(e)){raises++;lastRaiser=e.match(/\b(UTG|HJ|MP|LJ|CO|BTN|BU|SB|BB)\b/)?.[1]||lastRaiser;}
    else if(CALL.test(e))calls++;
  }
  if(raises===0)return calls===0?{node:'rfi',versus:null,reason:'Pote unopened.'}:{node:'unknown',versus:null,reason:'Existe limp anterior.'};
  if(raises>1)return {node:'unknown',versus:null,reason:'Mais de um raise pré-flop.'};
  if(calls>0)return {node:'unknown',versus:lastRaiser,reason:'Já existe call/limp além do agressor.'};
  return {node:'vs_open',versus:lastRaiser,reason:'Resposta a um único RFI.'};
}
