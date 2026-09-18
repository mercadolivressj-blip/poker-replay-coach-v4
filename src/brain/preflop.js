import { effectiveDepthBB, parseChips, parseBlinds } from './math.js';
import { rankValue } from './cards.js';
import { preflopBaselineDecision } from '../strategy-v1/preflop-baseline.js';
import { actionHistoryEntryText } from '../core/action-history.js';

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

// Legacy/fallback tables. Frozen 100z baseline remains authoritative where it has an audited node.
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

// Broad safety-net tiers. These are deliberately labelled heuristic and never reported as chart-certified.
const PREMIUM=range('JJ+,AKs,AKo');
const STRONG=range('88+,ATs+,KJs+,QJs,AQo+,AJs,KQs,A5s,A4s');
const CONTINUE=range('22+,A2s+,KTs+,QTs+,JTs,T9s,98s,87s,76s,ATo+,KJo+,QJo');
const SHORT_AGGRO=range('55+,A8s+,KTs+,QTs+,JTs,ATo+,KQo,A5s,A4s');

function actionHistoryNode(history){
 const arr=(history||[]).map(actionHistoryEntryText).map(x=>String(x).toUpperCase()).filter(Boolean); let raises=0,calls=0,versus=null;
 for(const e of arr){
   if(/RAISE|AUMENT|3-?BET|ALL-?IN|ALLIN/.test(e)){raises++; versus=e.match(/\b(UTG|HJ|CO|BTN|BU|SB|BB)\b/)?.[1]||versus;}
   else if(/CALL|PAGA|LIMP|IGUAL/.test(e)) calls++;
 }
 if(raises===0&&calls===0) return {node:'rfi',versus:null,calls,raises};
 if(raises===1&&calls===0) return {node:'vs_open',versus:normalizePosition(versus),calls,raises};
 if(raises===0&&calls>0) return {node:'limped',versus:null,calls,raises};
 return {node:'unknown',versus:normalizePosition(versus),calls,raises};
}

function percentileScore(cards){
 const [a,b]=cards.map(c=>({v:rankValue(c[0]),s:c[1]})); if(!a?.v||!b?.v)return 0;
 const hi=Math.max(a.v,b.v),lo=Math.min(a.v,b.v),pair=hi===lo,suited=a.s===b.s,gap=hi-lo;
 let s=hi*2+lo+(pair?18+hi:0)+(suited?4:0)-(gap>1?(gap-1)*2:0); if(hi===14)s+=5; if(hi>=11&&lo>=10)s+=5; return s;
}
const posAdj={UTG:0,HJ:-2,CO:-5,BTN:-8,SB:-6,BB:0};

function pack(decision,engine,reason,confidence,extra={}){return {decision,engine,reason,confidence,source:'deterministic',street:'preflop',...extra};}

function mttApprox({state,context,legal,position,depth}){
 const score=percentileScore(state.heroCards);
 const history=Array.isArray(state.actionHistory)?state.actionHistory:[];
 const explicitNode=String(context?.preflopNode??context?.node??'').trim().toLowerCase();
 const inferred=history.length?actionHistoryNode(history):{node:explicitNode==='rfi'?'rfi':'unknown',versus:null};
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
 if(unopened&&position&&hc&&RFI[position]?.has(hc)&&legal.includes('RAISE')) return pack('AUMENTAR','MTT PREFLOP V1 · APROXIMAÇÃO',`Range base por posição aceita ${hc}; MTT/ICM ainda não validado por chart próprio.`,58);
 if(legal.includes('CHECK')) return pack('PASSAR','MTT PREFLOP V1 · APROXIMAÇÃO','Sem custo adicional e sem autoridade suficiente para agressão.',58);
 if(legal.includes('CALL')&&CONTINUE.has(hc)) return pack('PAGAR','MTT PREFLOP V1 · APROXIMAÇÃO','Continuação conservadora por força relativa; chart/ICM específico ainda não certificado.',54);
 if(legal.includes('FOLD')) return pack('DESISTIR','MTT PREFLOP V1 · APROXIMAÇÃO','Spot fora da cobertura validada; linha conservadora até o módulo MTT/ICM ser auditado.',55);
 if(legal.includes('RAISE')) return pack('AUMENTAR','MTT PREFLOP V1 · APROXIMAÇÃO','Única ação agressiva legal disponível no fallback.',50);
 return pack(legal[0]||null,'MTT PREFLOP V1 · APROXIMAÇÃO','Fallback legal de último recurso.',45);
}

function universalCashFallback({state,legal,position,depth,hc,node,reasonHint=''}){
 const set=new Set(legal.map(x=>String(x).toUpperCase()));
 const call=parseChips(state.toCall)??0;
 const stack=parseChips(state.effectiveStack)??parseChips(state.heroStack);
 const blinds=parseBlinds(state.blinds);
 const callBB=blinds?.bb>0?call/blinds.bb:null;
 const callFrac=stack>0?call/stack:null;
 const premium=PREMIUM.has(hc), strong=STRONG.has(hc), cont=CONTINUE.has(hc), shortAggro=SHORT_AGGRO.has(hc);
 const d=depth==null?100:depth;
 const contextText=[position||'posição não confirmada',depth==null?'depth não confirmado':`~${depth.toFixed(0)}bb`,node?.node||'node desconhecido'].join(' · ');
 const extra={chartCertified:false,universalFallback:true,inferredNode:node?.node||'unknown',inferredPosition:position||null};

 // Free option: never fold a free check. Raise only with a conservative value/iso tier.
 if(set.has('CHECK')&&!set.has('CALL')){
   const iso=d<=30?shortAggro:strong;
   if(set.has('RAISE')&&iso) return pack('AUMENTAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: mão forte o bastante para agressão no fallback. ${reasonHint}`.trim(),60,extra);
   return pack('PASSAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: check grátis preserva equity sem inventar um raise marginal. ${reasonHint}`.trim(),64,extra);
 }

 // Unopened-like state: use the known position range, or HJ as a conservative unknown-position proxy.
 if(call<=0&&!set.has('CALL')&&set.has('RAISE')){
   const openRange=position&&RFI[position]?RFI[position]:RFI.HJ;
   if(openRange.has(hc)) return pack('AUMENTAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: ${hc} está dentro da faixa conservadora de abertura usada pelo fallback. ${reasonHint}`.trim(),position?64:56,extra);
   if(set.has('FOLD')) return pack('DESISTIR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: ${hc} fica fora da faixa conservadora de abertura do fallback. ${reasonHint}`.trim(),position?62:54,extra);
 }

 // Facing a price / unknown action tree.
 if(set.has('CALL')){
   const hugePrice=callFrac!=null&&callFrac>=0.55;
   const mediumPrice=callFrac!=null&&callFrac>=0.25;
   const cheapPrice=(callBB!=null&&callBB<=2.5)||(callFrac!=null&&callFrac<=0.12);
   if((d<=15&&shortAggro||premium)&&set.has('ALLIN')) return pack('ALL-IN','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: topo/short-stack do fallback com ação all-in legal. ${reasonHint}`.trim(),58,extra);
   if(premium&&set.has('RAISE')&&!hugePrice) return pack('AUMENTAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: premium mantém iniciativa no fallback. ${reasonHint}`.trim(),65,extra);
   if(premium) return pack('PAGAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: premium continua mesmo sem node completo. ${reasonHint}`.trim(),64,extra);
   if(strong&&!hugePrice){
     if(set.has('RAISE')&&d<=35&&!mediumPrice) return pack('AUMENTAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: mão forte + stack reduzido favorecem agressão no fallback. ${reasonHint}`.trim(),59,extra);
     return pack('PAGAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: mão forte continua contra preço não extremo. ${reasonHint}`.trim(),58,extra);
   }
   if(cont&&cheapPrice&&!hugePrice) return pack('PAGAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: preço baixo e mão de continuação permitem call conservador. ${reasonHint}`.trim(),54,extra);
   if(set.has('FOLD')) return pack('DESISTIR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: sem node certificado, força/preço não justificam continuar no fallback. ${reasonHint}`.trim(),56,extra);
   return pack('PAGAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: call é a única continuação legal disponível. ${reasonHint}`.trim(),48,extra);
 }

 if(set.has('FOLD')) return pack('DESISTIR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: fallback conservador sem opção gratuita/continuação confirmada. ${reasonHint}`.trim(),52,extra);
 if(set.has('RAISE')) return pack('AUMENTAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: raise é a ação legal utilizável pelo fallback. ${reasonHint}`.trim(),48,extra);
 if(set.has('ALLIN')) return pack('ALL-IN','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: all-in é a ação legal utilizável pelo fallback. ${reasonHint}`.trim(),45,extra);
 if(set.has('BET')) return pack('AUMENTAR','PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: ação agressiva legal mapeada pelo fallback. ${reasonHint}`.trim(),45,extra);
 return pack(legal[0]||null,'PREFLOP UNIVERSAL · HEURÍSTICA',`${contextText}: última ação legal disponível. ${reasonHint}`.trim(),40,extra);
}

export function preflopDecision(state,context={}){
 const legal=(state.legalActions||[]).map(x=>String(x).toUpperCase());
 const hc=handCode(state.heroCards);
 const legalSet=new Set(legal);
 if(!hc||!legal.length) return {decision:null,engine:'BRAIN GATE',reason:'Faltam cartas ou ações legais confirmadas.',confidence:0,street:'preflop'};

 const bbFreeOption=legalSet.has('CHECK')&&legalSet.has('RAISE')&&!legalSet.has('CALL')&&!legalSet.has('FOLD')&&!(state.board||[]).length;
 let position=bbFreeOption?'BB':normalizePosition(state.heroPosition);
 const depth=effectiveDepthBB(state.heroStack,state.effectiveStack,state.blinds);
 const explicitNode=String(context?.preflopNode??context?.node??'').trim().toLowerCase();
 const inferredHistoryNode=actionHistoryNode(state.actionHistory||[]);
 const facingCost=legalSet.has('CALL')&&((parseChips(state.toCall)??0)>0);

 if((context.format||'cash')!=='cash'){
   const approx=mttApprox({state,context,legal,position,depth});
   return {...approx,certification:'approximation-only',chartCertified:false,icmCertified:false,solverCertified:false};
 }

 // Sovereign BB option from the legal buttons beats noisy metadata.
 if(bbFreeOption){
   return universalCashFallback({state,legal,position:'BB',depth,hc,node:{node:'limped'},reasonHint:'CHECK+RAISE pré-flop confirma opção do BB.'});
 }

 // Try the audited frozen baseline first whenever enough structured context exists.
 let exact=null;
 if(position){
   const historyKey=(state.actionHistory||[]).map(actionHistoryEntryText).join('>');
   const decisionKey=context.decisionKey||[context.handId??'',state.heroCards.join(''),position,historyKey].join('|');
   exact=preflopBaselineDecision({
     heroCards:state.heroCards,board:state.board||[],heroPosition:position,legalActions:legal,
     actionHistory:state.actionHistory||[],node:context.preflopNode??context.node,versus:context.versus??null,
     multiway:context.preflopMultiway===true,depthBB:depth,format:'cash',tableSize:context.tableSize||'6max',decisionKey
   });
   if(exact?.kind==='decision') return pack(exact.advice,exact.engine,exact.reason,88,{actionCode:exact.actionCode,baselineAction:exact.baselineAction,distribution:exact.distribution,mixed:exact.mixed,decisionKey,roll:exact.roll,chartCertified:true});
 }

 // Legacy 100bb tables still improve precision when node + position are available.
 const node=(state.actionHistory||[]).length?inferredHistoryNode:{node:explicitNode==='rfi'?'rfi':explicitNode==='vs_open'?'vs_open':'unknown',versus:normalizePosition(context.versus)};
 if(position&&depth!=null&&depth>=90&&depth<=110){
   if(node.node==='rfi'&&position!=='BB'){
     const yes=RFI[position]?.has(hc);
     if(yes&&legalSet.has('RAISE')) return pack('AUMENTAR','PREFLOP LEGACY · FALLBACK',`${position} RFI: ${hc} está na tabela legada; baseline direta não cobriu o estado estruturado.`,58,{chartCertified:false});
     if(!yes&&legalSet.has('FOLD')) return pack('DESISTIR','PREFLOP LEGACY · FALLBACK',`${position} RFI: ${hc} não está na tabela legada.`,58,{chartCertified:false});
   }
   if(node.node==='vs_open'&&node.versus){
     const d=DEF[`${position}:${node.versus}`];
     if(d){
       if(d.r.has(hc)&&legalSet.has('RAISE')) return pack('AUMENTAR','PREFLOP LEGACY · FALLBACK',`${position} vs ${node.versus}: ${hc} pertence à faixa legada de 3-bet.`,58,{chartCertified:false});
       if(d.c.has(hc)&&legalSet.has('CALL')) return pack('PAGAR','PREFLOP LEGACY · FALLBACK',`${position} vs ${node.versus}: ${hc} pertence à faixa legada de call.`,56,{chartCertified:false});
       if(legalSet.has('FOLD')) return pack('DESISTIR','PREFLOP LEGACY · FALLBACK',`${position} vs ${node.versus}: fora das faixas legadas de continuação.`,58,{chartCertified:false});
     }
   }
 }

 // Product requirement: never stay silent preflop when cards + legal actions exist in replay study.
 const hintParts=[];
 if(!position) hintParts.push('posição ainda não confirmada');
 if(depth==null) hintParts.push('depth ainda não confirmado'); else if(depth<90||depth>110) hintParts.push('fora da baseline exata de 100bb');
 if(facingCost&&node.node!=='vs_open') hintParts.push('opener/node não confirmado');
 if(exact?.reason) hintParts.push(`baseline: ${exact.reason}`);
 return universalCashFallback({state,legal,position,depth,hc,node,reasonHint:hintParts.join('; ')});
}
