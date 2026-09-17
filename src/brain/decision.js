import { preflopDecision } from './preflop.js';
import { postflopDecision } from './postflop.js';

const ACTION_MAP={
 'DESISTIR':'FOLD','PASSAR':'CHECK','PAGAR':'CALL','AUMENTAR':'RAISE','ALL-IN':'ALLIN'
};
function actionCode(label){
 if(!label) return null; const s=String(label).toUpperCase();
 if(s.startsWith('APOSTAR')) return 'BET';
 for(const [pt,en] of Object.entries(ACTION_MAP)) if(s.startsWith(pt)) return en;
 return null;
}

export function decisionStreet(board){ const n=Array.isArray(board)?board.length:0; return n>=5?'river':n===4?'turn':n>=3?'flop':'preflop'; }

export function enforceLegal(decision,state){
 if(!decision?.decision) return decision;
 const code=actionCode(decision.decision); const legal=new Set(state.legalActions||[]);
 if(!code||!legal.has(code)) return {...decision,decision:null,confidence:0,engine:'LEGAL MASK',reason:`Decisão ${decision.decision} bloqueada: botão ${code||'?'} não está entre as ações confirmadas (${[...legal].join(', ')}).`};
 return {...decision,actionCode:code};
}

export function decideBrain(state,context={}){
 const street=decisionStreet(state.board);
 const raw=street==='preflop'?preflopDecision(state,context):postflopDecision(state,context);
 const safe=enforceLegal(raw,state);
 return {
   version:'brain-v1',
   strategyVersion:'strategy-v1-external-port',
   street,
   format:context.format||'cash',
   decision:safe?.decision??null,
   actionCode:safe?.actionCode??null,
   engine:safe?.engine??'BRAIN GATE',
   confidence:safe?.confidence??0,
   reason:safe?.reason??'Estado insuficiente.',
   details:safe?.notes??safe?.details??null,
   stateKey:[state.heroCards?.join('')||'',state.board?.join('')||'',state.pot||'',state.toCall||'',(state.legalActions||[]).join('-'),state.heroPosition||'',state.heroStack||''].join('|'),
   capturedAt:state.capturedAt,
 };
}
