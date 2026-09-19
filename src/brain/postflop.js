import { evaluateHand, drawAnalysis, boardTexture } from './cards.js';
import { effectiveDepthBB, potOdds, spr, outsEquity, round1 } from './math.js';

const pack=(decision,engine,reason,confidence,extra={})=>({decision,engine,reason,confidence,source:'deterministic',...extra});
const has=(legal,a)=>legal.includes(a);
const streetOf=(board)=>board.length>=5?'river':board.length===4?'turn':board.length>=3?'flop':'preflop';

export function postflopDecision(state,context={}){
 const street=streetOf(state.board||[]); const legal=state.legalActions||[];
 if(street==='preflop') return null;
 const hand=evaluateHand(state.heroCards,state.board); if(!hand||!legal.length) return pack(null,'POSTFLOP GATE','Mão ou ações legais ainda não confirmadas.',0,{street});
 const texture=boardTexture(state.board); const draws=drawAnalysis(state.heroCards,state.board);
 const odds=potOdds(state.pot,state.toCall); const sprRead=spr(state.pot,state.heroStack,state.effectiveStack); const depth=effectiveDepthBB(state.heroStack,state.effectiveStack,state.blinds);
 const players=state.activePlayers ?? state.players ?? null; const multiway=players!=null&&players>2;
 const facing=has(legal,'CALL')&&!has(legal,'CHECK'); const drawEq=outsEquity(draws.cleanOuts,street);
 const required=odds?.requiredEquity ?? null; const notes=[];
 notes.push(`${hand.name}; força relativa: ${hand.relative}`); notes.push(`board ${texture.label}`);
 if(draws.labels.length) notes.push(`draws: ${draws.labels.join(', ')}`); if(required!=null) notes.push(`equity mínima ~${round1(required)}%`); if(sprRead) notes.push(`SPR ${round1(sprRead.value)} (${sprRead.regime})`); if(depth!=null) notes.push(`~${round1(depth)}bb efetivos`); if(multiway) notes.push('multiway: value mais forte e menos blefe');
 const detail={street,hand:{name:hand.name,relative:hand.relative,tier:hand.tier},texture,draws:{...draws,equityApprox:drawEq},math:{requiredEquity:round1(required),spr:round1(sprRead?.value??null),effectiveBB:round1(depth)},notes};

 // Facing a bet / call decision.
 if(facing){
   if(hand.relative==='nuts ou quase nuts'){
     if(has(legal,'RAISE')) return pack('AUMENTAR','POSTFLOP BRAIN V1','Mão no topo da range contra aposta; construir valor.',86,detail);
     if(has(legal,'CALL')) return pack('PAGAR','POSTFLOP BRAIN V1','Mão no topo da range; call é a melhor ação legal disponível.',82,detail);
   }
   if(hand.relative==='mão forte'){
     if(!multiway&&has(legal,'RAISE')&&sprRead?.value!=null&&sprRead.value<=4) return pack('AUMENTAR','POSTFLOP BRAIN V1','Mão forte + SPR baixo em heads-up sustenta aumento por valor.',78,detail);
     if(has(legal,'CALL')) return pack('PAGAR','POSTFLOP BRAIN V1','Mão forte suficiente para continuar sem transformar em blefe.',80,detail);
   }
   if(hand.relative==='mão média / showdown value'){
     if(required!=null&&required<=28&&!multiway&&has(legal,'CALL')) return pack('PAGAR','POSTFLOP BRAIN V1','Showdown value e preço aceitável; manter bluffs do vilão na range.',70,detail);
     if(has(legal,'FOLD')) return pack('DESISTIR','POSTFLOP BRAIN V1','Showdown value insuficiente para este preço/contexto; evitar overcall.',70,detail);
   }
   if(hand.relative==='bluff catcher'){
     // Conservative population baseline: large/unknown river aggression is underbluffed.
     if(street==='river'){
       if(required!=null&&required<=20&&!multiway&&context.villainProfile==='overbluffer'&&has(legal,'CALL')) return pack('PAGAR','POSTFLOP BRAIN V1 · EXPLOIT','Bluff catcher com preço baixo e read explícito de overbluff.',62,detail);
       if(has(legal,'FOLD')) return pack('DESISTIR','POSTFLOP BRAIN V1','River bluff catcher sem evidência de overbluff: baseline conservadora.',78,detail);
     }
     if(required!=null&&required<=22&&!multiway&&has(legal,'CALL')) return pack('PAGAR','POSTFLOP BRAIN V1','Preço muito bom permite defender bluff catcher em heads-up.',62,detail);
     if(has(legal,'FOLD')) return pack('DESISTIR','POSTFLOP BRAIN V1','Bluff catcher sem preço ou contexto suficiente para hero-call.',72,detail);
   }
   if(street!=='river'&&draws.cleanOuts>0){
     if(required!=null&&drawEq>=required+3&&has(legal,'CALL')) return pack('PAGAR','POSTFLOP BRAIN V1','Equity aproximada dos outs limpos supera o preço do call.',68,detail);
     if(draws.comboDraw&&!multiway&&has(legal,'RAISE')) return pack('AUMENTAR','POSTFLOP BRAIN V1','Combo draw forte: equity + fold equity justificam semi-blefe.',63,detail);
   }
   if(has(legal,'FOLD')) return pack('DESISTIR','POSTFLOP BRAIN V1','Range fraco contra pressão e sem matemática suficiente para continuar.',76,detail);
   if(has(legal,'CALL')) return pack('PAGAR','POSTFLOP BRAIN V1','Call é a única continuação legal; confiança reduzida.',45,detail);
 }

 // Checked to hero / first action.
 if(has(legal,'CHECK')){
   if(hand.relative==='nuts ou quase nuts'&&has(legal,'BET')) return pack('APOSTAR 75%','POSTFLOP BRAIN V1','Topo da range: apostar grande por valor e construção de pote.',84,detail);
   if(hand.relative==='mão forte'&&has(legal,'BET')) return pack(texture.paired||texture.monotone?'APOSTAR 50%':'APOSTAR 66%','POSTFLOP BRAIN V1','Mão forte com calls piores plausíveis; apostar por valor.',80,detail);
   if(hand.relative==='mão média / showdown value'){
     if(!multiway&&!texture.connected&&!texture.monotone&&has(legal,'BET')) return pack('APOSTAR 33%','POSTFLOP BRAIN V1','Thin value/proteção em textura estável e heads-up.',65,detail);
     return pack('PASSAR','POSTFLOP BRAIN V1','Showdown value prefere controle de pote neste contexto.',76,detail);
   }
   if(street!=='river'&&draws.comboDraw&&!multiway&&has(legal,'BET')) return pack('APOSTAR 66%','POSTFLOP BRAIN V1','Combo draw é bom candidato a semi-blefe em heads-up.',66,detail);
   if(street!=='river'&&(draws.flushDraw||draws.straightDraw)&&!multiway&&has(legal,'BET')&&context.heroIsPreflopAggressor===true) return pack('APOSTAR 33%','POSTFLOP BRAIN V1','Draw com equity e iniciativa: semi-blefe pequeno é defensável.',58,detail);
   return pack('PASSAR','POSTFLOP BRAIN V1','Sem value claro nem bluff com justificativa suficiente; preservar showdown/equity.',78,detail);
 }

 if(has(legal,'BET')){
   if(hand.relative==='nuts ou quase nuts'||hand.relative==='mão forte') return pack('APOSTAR 66%','POSTFLOP BRAIN V1','Value claro entre as ações disponíveis.',76,detail);
 }
 return pack(null,'POSTFLOP BRAIN V1','Nenhuma decisão confiável fechou com as ações legais atuais.',0,detail);
}
