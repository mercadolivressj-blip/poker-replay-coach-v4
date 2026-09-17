import { effectiveDepthBB } from './math.js';
import { rankValue } from './cards.js';
import { preflopBaselineDecision } from '../strategy-v1/preflop-baseline.js';

const ORDER='23456789TJQKA';
const idx=(r)=>ORDER.indexOf(String(r||'').toUpperCase());
export function normalizePosition(v){
  if(!v) return null; const x=String(v).trim().toUpperCase();
  return ({EP:'UTG',MP:'HJ',LJ:'HJ',BU:'BTN',BUTTON:'BTN',UTG:'UTG',HJ:'HJ',CO:'CO',BTN:'BTN',SB:'SB',BB:'BB'})[x]||null;
}
export function handCode(cards){
  if(!Array.isArray(cards)||cards.length!==2) return null;
  const [a,b]=cards; if(!/^[2-9TJQKA][hdcs]$/.test(a)||!/^[2-9TJQKA][hdcs]$/.test(b)) return null;
  const r1=a[0],r2=b[0]; if(r1===r2) return `${r1}${r1}`;
  const hi=idx(r1)>idx(r2)?r1:r2, lo=hi===r1?r2:r1, suited=a[1]===b[1]; return `${hi}${lo}${suited?'s':'o'}`;
}
function expand(token){
  const plus=token.endsWith('+'), body=plus?token.slice(0,-1):token, hi=body[0], lo=body[1], suit=body.slice(2); const out=[];
  if(hi===lo){ for(let i=idx(hi);i<ORDER.length;i++){out.push(`${ORDER[i]}${ORDER[i]}`);if(!plus)break;} return out; }
  for(let i=idx(lo);i<idx(hi);i++){out.push(`${hi}${ORDER[i]}${suit}`);if(!plus)break;} return out;
}
const range=(s)=>new Set(s.split(',').map(x=>x.trim()).filter(Boolean).flatMap(expand));

// LEGACY/FALLBACK tables only. Frozen 100z baseline above has authority in its audited nodes.
const RFI={
 UTG:range('22+,A2s+,KTs+,QTs+,JTs,T9s,98s,87s,76s,AJo+,KQo'),
 HJ:range('22+,A2s+,K9s+,Q9s+,J9s+,T8s+,97s+,86s+,75s+,65s,ATo+,KJo+,QJo'),
 CO:range('22+,A2s+,K7s+,Q8s+,J8s+,T7s+,96s+,86s+,75s+,64s+,54s,A9o+,KTo+,QTo+,JTo'),
 BTN:range('22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,74s+,63s+,53s+,43s,A2o+,K7o+,Q8o+,J8o+,T8o+,97o+,87o'),
 SB:range('22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,86s+,75s+,64s+,54s,A2o+,K8o+,Q9o+,J9o+,T9o'),
 BB:new Set()
};
const DEF={
 'BB:UTG':{r:range('JJ+,AKs,AQs,AKo,A5s,A4s,KJs'),c:range('22+,A2s+,K9s+,Q9s+,J9s+,T8s+,97s+,86s+,75s+,65s,AJo+,KQo,QJo,JTo')},
 'BB:CO':{r:range('TT+,AJs+,AKo,AQo,A5s,A4s,A3s,KJs+,QJs,T9s,76s'),c:range('22+,A2s+,K5s+,Q7s+,J7s+,T7s+,96s+,85s+,74s+,64s+,53s+,ATo+,KTo+,QTo+,JTo,T9o')},
 'BB:BTN':{r:range('99+,ATs+,AQo+,A5s,A4s,A3s,A2s,KTs+,QTs+,JTs,T9s,98s,87s,76s,65s'),c:range('22+,A2s+,K2s+,Q4s+,J6s+,T6s+,95s+,84s+,74s+,63s+,53s+,A2o+,K7o+,Q8o+,J8o+,T8o+,97o+,87o')},
 'BB:SB':{r:range('88+,ATs+,KTs+,QTs+,JTs,T9s,98s,87s,76s,65s,A9o+,KJo+,QJo,A5s,A4s'),c:range('22+,A2s+,K2s+,Q2s+,J4s+,T5s+,95s+,84s+,73s+,63s+,53s+,43s,A2o+,K5o+,Q7o+,J7o+,T7o+,96o+,86o+,75o+,65o')},
 'SB:BTN':{r:range('77+,A9s+,KTs+,QTs+,JTs,T9s,98s,87s,76s,A5s,A4s,A3s,ATo+,KQo'),c:range('55+,AJs+,KJs+,QJs')},
 'BTN:CO':{r:range('TT+,AJs+,AQo+,KTs+,QTs+,JTs,T9s,87s,76s,A5s,A4s'),c:range('22+,ATs+,KTs+,QTs+,JTs,T9s,98s,87s,76s,65s,AJo+,KQo,QJo')},
 'CO:UTG':{r:range('QQ+,AKs,AQs,AKo,A5s'),c:range('22+,AJs+,KJs+,QJs,JTs,T9s,98s,AQo+')}
};

function actionHistoryNode(history){
 const arr=(history||[]).map(x=>String(x).toUpperCase()); let raises=0,calls=0,versus=null;
 for(const e of arr){ if(/RAISE|AUMENT|3-?BET|ALL-?IN|ALLIN/.test(e)){raises++; versus=e.match(/\b(UTG|HJ|CO|BTN|BU|SB|BB)\b/)?.[1]||versus;} else if(/CALL|PAGA|LIMP|IGUAL/.test(e)) calls++; }
 if(raises===0&&calls===0) return {node:'rfi',versus:null};
 if(raises===1&&calls===0) return {node:'vs_open',versus:normalizePosition(versus)};
 return {node:'unknown',versus:normalizePosition(versus)};
}

function percentileScore(cards){
 const [a,b]=cards.map(c=>({v:rankValue(c[0]),s:c[1]})); if(!a?.v||!b?.v)return 0;
 const hi=Math.max(a.v,b.v),lo=Math.min(a.v,b.v),pair=hi===lo,suited=a.s===b.s,gap=hi-lo;
 let s=hi*2+lo+(pair?18+hi:0)+(suited?4:0)-(gap>1?(gap-1)*2:0); if(hi===14)s+=5; if(hi>=11&&lo>=10)s+=5; return s;
}
const posAdj={UTG:0,HJ:-2,CO:-5,BTN:-8,SB:-6,BB:0};

function mttApprox({state,context,legal,position,depth}){
 const score=percentileScore(state.heroCards);
 const history=Array.isArray(state.actionHistory)?state.actionHistory:[];
 const explicitNode=String(context?.preflopNode??context?.node??'').trim().toLowerCase();
 if(!history.length&&explicitNode!=='rfi'){
   return pack(null,'MTT PREFLOP V1 · ESTADO INSUFICIENTE','Histórico/node pré-flop não confirmado; pote unopened não será presumido.',0);
 }
 const inferred=history.length?actionHistoryNode(history):{node:'rfi',versus:null};
 const unopened=inferred.node==='rfi';
 const rp=Math.max(0,Number(context?.icmRiskPremiumPct)||0); const callPenalty=rp*0.35;
 if(depth!=null&&depth<=8){
   const threshold=(unopened?48:60)+(posAdj[position]||0)+(unopened?0:callPenalty);
   if(score>=threshold && legal.includes('ALLIN')) return pack('ALL-IN','MTT SHORT STACK V1 · APROXIMAÇÃO',`~${depth.toFixed(1)}bb: regime push/fold; score relativo ${score.toFixed(0)} ≥ limiar ${threshold.toFixed(0)}.`,65);
   if(legal.includes('FOLD')) return pack('DESISTIR','MTT SHORT STACK V1 · APROXIMAÇÃO',`~${depth.toFixed(1)}bb e força abaixo do limiar desta posição/ação.`,68);
 }
 if(depth!=null&&depth<=15&&unopened){
   const threshold=52+(posAdj[position]||0);
   if(score>=threshold && (legal.includes('RAISE')||legal.includes('ALLIN'))) return pack(legal.includes('RAISE')?'AUMENTAR':'ALL-IN','MTT SHORT STACK V1 · APROXIMAÇÃO',`~${depth.toFixed(1)}bb unopened: mão acima do limiar agressivo da posição.`,62);
 }
 const hc=handCode(state.heroCards);
 if(unopened&&position&&hc&&RFI[position]?.has(hc)){
   if(legal.includes('RAISE')) return pack('AUMENTAR','MTT PREFLOP V1 · APROXIMAÇÃO',`Range base por posição aceita ${hc}; MTT/ICM ainda não validado por chart próprio.`,58);
 }
 if(legal.includes('CHECK')) return pack('PASSAR','MTT PREFLOP V1 · APROXIMAÇÃO','Sem custo adicional e sem autoridade suficiente para agressão.',58);
 if(legal.includes('FOLD')) return pack('DESISTIR','MTT PREFLOP V1 · APROXIMAÇÃO','Spot fora da cobertura validada; linha conservadora até o módulo MTT/ICM ser auditado.',55);
 return null;
}

function pack(decision,engine,reason,confidence,extra={}){return {decision,engine,reason,confidence,source:'deterministic',street:'preflop',...extra};}

export function preflopDecision(state,context={}){
 const legal=state.legalActions||[]; const position=normalizePosition(state.heroPosition); const hc=handCode(state.heroCards);
 if(!hc||!position||!legal.length) return {decision:null,engine:'BRAIN GATE',reason:'Faltam cartas, posição ou ações legais confirmadas.',confidence:0,street:'preflop'};
 const depth=effectiveDepthBB(state.heroStack,state.effectiveStack,state.blinds);
 if((context.format||'cash')!=='cash'){
   const approx=mttApprox({state,context,legal,position,depth})||pack(null,'MTT PREFLOP V1 · APROXIMAÇÃO','Sem decisão confiável para este node.',0);
   return {...approx,certification:'approximation-only',chartCertified:false,icmCertified:false,solverCertified:false};
 }

 // AUTHORITATIVE frozen Strategy V1 baseline first.
 const decisionKey=context.decisionKey||[context.handId??'',state.heroCards.join(''),position,(state.actionHistory||[]).join('>')].join('|');
 const exact=preflopBaselineDecision({
   heroCards:state.heroCards,board:state.board||[],heroPosition:state.heroPosition,legalActions:legal,
   actionHistory:state.actionHistory||[],node:context.preflopNode??context.node,versus:context.versus??null,
   multiway:context.preflopMultiway===true,depthBB:depth,format:'cash',tableSize:context.tableSize||'6max',decisionKey
 });
 if(exact?.kind==='decision') return pack(exact.advice,exact.engine,exact.reason,88,{actionCode:exact.actionCode,baselineAction:exact.baselineAction,distribution:exact.distribution,mixed:exact.mixed,decisionKey,roll:exact.roll});
 if(exact?.kind==='inconsistent') return pack(null,'PREFLOP V1 · ESTADO INCONSISTENTE',exact.reason,0,{baselineAction:exact.baselineAction});

 // Missing action history is missing critical context, not an excuse to assume RFI.
 if(!(state.actionHistory||[]).length) return pack(null,'BRAIN GATE','Histórico pré-flop ainda não confirmado; aguardando node antes de decidir.',0);

 // Legacy fallback remains only for uncovered/non-authoritative nodes.
 const node=actionHistoryNode(state.actionHistory);
 if(depth==null||depth<90||depth>110) return pack(null,'PREFLOP V1 · FORA DA FAIXA','Baseline cash direta só assume autoridade em ~90–110bb; spot segue fora da faixa validada.',0);
 if(node.node==='rfi'){
   const yes=RFI[position]?.has(hc); if(yes&&legal.includes('RAISE')) return pack('AUMENTAR','PREFLOP LEGACY · FALLBACK',`${position} RFI: ${hc} está na tabela legada; baseline direta não cobriu o estado estruturado.`,55);
   if(!yes&&legal.includes('FOLD')) return pack('DESISTIR','PREFLOP LEGACY · FALLBACK',`${position} RFI: ${hc} não está na tabela legada.`,55);
   if(legal.includes('CHECK')) return pack('PASSAR','PREFLOP LEGACY · FALLBACK','Check grátis disponível.',55);
 }
 if(node.node==='vs_open'&&node.versus){
   const d=DEF[`${position}:${node.versus}`]; if(d){
     if(d.r.has(hc)&&legal.includes('RAISE')) return pack('AUMENTAR','PREFLOP LEGACY · FALLBACK',`${position} vs ${node.versus}: ${hc} pertence à faixa legada de 3-bet.`,55);
     if(d.c.has(hc)&&legal.includes('CALL')) return pack('PAGAR','PREFLOP LEGACY · FALLBACK',`${position} vs ${node.versus}: ${hc} pertence à faixa legada de call.`,52);
     if(legal.includes('FOLD')) return pack('DESISTIR','PREFLOP LEGACY · FALLBACK',`${position} vs ${node.versus}: fora das faixas legadas de continuação.`,55);
   }
 }
 return pack(null,'PREFLOP V1 · NODE NÃO COBERTO','Node não coberto pela baseline auditada; nenhuma jogada será inventada.',0);
}
