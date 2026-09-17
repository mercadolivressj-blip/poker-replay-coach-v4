import { preflopDecision } from './preflop.js';
import { postflopPolicyV4Decision } from './postflop-policy-v4.js';
import { buildLedgerFromState, heroWasPreflopAggressor, ledgerSummary } from './action-ledger.js';
import { observedLedgerSummary } from './observed-ledger.js';
import { buildBrainKnowledge } from './knowledge.js';
import { STRATEGY_V1_MANIFEST } from './strategy-manifest.js';

const ACTION_MAP={
 'DESISTIR':'FOLD','PASSAR':'CHECK','PAGAR':'CALL','AUMENTAR':'RAISE','ALL-IN':'ALLIN'
};
function actionCode(label){
 if(!label) return null; const s=String(label).trim().toUpperCase();
 if(s.startsWith('APOSTAR')) return 'BET';
 for(const [pt,en] of Object.entries(ACTION_MAP)) if(s.startsWith(pt)) return en;
 return null;
}

function legalActionSet(state){
 const legal=new Set(state?.legalActions||[]);
 const postflop=Array.isArray(state?.board)&&state.board.length>=3;
 // PokerBench/frozen Strategy V1 semantic quirk: when there is no call pending,
 // an opening RAISE menu entry is the same real button/meaning as BET.
 if(postflop&&legal.has('RAISE')&&!legal.has('CALL')&&legal.has('CHECK')) legal.add('BET');
 return legal;
}

function mixedCodes(label){
 const s=String(label||'');
 if(!/^ESTRAT[ÉE]GIA MISTA\s*:/i.test(s)) return null;
 const body=s.replace(/^ESTRAT[ÉE]GIA MISTA\s*:/i,'');
 const codes=[...new Set(body.split('/').map((part)=>actionCode(part)).filter(Boolean))];
 return codes.length>=2?codes:null;
}

function detailedLedgerSummary(ledger){
 const base=ledgerSummary(ledger);
 return {...base,actions:(ledger?.actions||[]).slice(-30).map(a=>({
   seq:a.seq,street:a.street,actor:a.actor,action:a.action,
   amount:a.amount??null,toAmount:a.toAmount??null,allIn:Boolean(a.allIn),raw:a.raw??null,
 }))};
}

export function decisionStreet(board){ const n=Array.isArray(board)?board.length:0; return n>=5?'river':n===4?'turn':n>=3?'flop':'preflop'; }

export function enforceLegal(decision,state){
 if(!decision?.decision) return decision;
 const legal=legalActionSet(state);
 const mix=mixedCodes(decision.decision);
 if(mix){
   const illegal=mix.filter((code)=>!legal.has(code));
   if(illegal.length) return {
     ...decision,decision:null,confidence:0,engine:'LEGAL MASK',
     reason:`Estratégia mista bloqueada: ${illegal.join('/')} não está entre as ações confirmadas (${[...legal].join(', ')}).`,
   };
   return {...decision,actionCode:'MIXED',mixed:true,mixedActionCodes:mix};
 }
 const code=actionCode(decision.decision);
 if(!code||!legal.has(code)) return {...decision,decision:null,confidence:0,engine:'LEGAL MASK',reason:`Decisão ${decision.decision} bloqueada: botão ${code||'?'} não está entre as ações confirmadas (${[...legal].join(', ')}).`};
 return {...decision,actionCode:code};
}

export function decideBrain(state,context={}){
 const street=decisionStreet(state.board);
 const ledger=context.ledger && typeof context.ledger==='object'
   ? context.ledger
   : buildLedgerFromState(state,{handId:context.handId??null,heroActor:context.heroActor??null});
 const heroPfa=heroWasPreflopAggressor(ledger);
 const knowledge=buildBrainKnowledge(state,{
   ledger,
   profiles:context.profiles??null,
   captureCandidates:context.captureCandidates??[],
 });
 const resolvedContext={
   ...context,
   ledger,
   knowledge,
   heroIsPreflopAggressor: context.heroIsPreflopAggressor ?? heroPfa,
 };
 const raw=street==='preflop'?preflopDecision(state,resolvedContext):postflopPolicyV4Decision(state,resolvedContext);
 const safe=enforceLegal(raw,state);
 return {
   version:'brain-v1',
   strategyVersion:STRATEGY_V1_MANIFEST.version,
   strategyStatus:{
     preflop:STRATEGY_V1_MANIFEST.preflop.status,
     postflop:STRATEGY_V1_MANIFEST.postflop.status,
     policyComplete:STRATEGY_V1_MANIFEST.policyComplete,
   },
   ledgerVersion:'action-ledger-v1-external',
   observedLedgerVersion:'observed-ledger-v1',
   knowledgeVersion:knowledge.version,
   street,
   format:context.format||'cash',
   decision:safe?.decision??null,
   actionCode:safe?.actionCode??null,
   mixed:Boolean(safe?.mixed),
   mixedActionCodes:safe?.mixedActionCodes??null,
   engine:safe?.engine??'BRAIN GATE',
   confidence:safe?.confidence??0,
   reason:safe?.reason??'Estado insuficiente.',
   details:safe?.notes??safe?.details??null,
   ledger:detailedLedgerSummary(ledger),
   observedLedger:observedLedgerSummary(context.observedLedger),
   knowledge,
   stateKey:[state.heroCards?.join('')||'',state.board?.join('')||'',state.pot||'',state.toCall||'',(state.legalActions||[]).join('-'),state.heroPosition||'',state.heroStack||'',(state.actionHistory||[]).slice(-8).join('>')].join('|'),
   capturedAt:state.capturedAt,
 };
}
