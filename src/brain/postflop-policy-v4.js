import { analyzePostflop } from '../strategy-v1/runtime/postflop.js';
import { policyDecision } from '../strategy-v1/runtime/postflop-policy-decision.js';

const STREET_ORDER=['preflop','flop','turn','river'];
const MARKER={preflop:'PREFLOP',flop:'FLOP',turn:'TURN',river:'RIVER'};
const CONFIDENCE_PCT={alta:90,media:75,baixa:55};

const money=(v)=>{\n  if(v==null||String(v).trim()==='')return null;\n  const n=Number(v);\n  return Number.isFinite(n)?n:null;\n};

export function policyHistoryFromLedger(ledger){
  const actions=Array.isArray(ledger?.actions)?ledger.actions:[];
  if(!actions.length)return [];
  const out=[];
  for(const street of STREET_ORDER){
    const rows=actions.filter((a)=>a?.street===street);
    if(!rows.length)continue;
    out.push(MARKER[street]);
    for(const a of rows){
      if(!a?.actor||!a?.action)continue;
      const amount=money(a.toAmount)??money(a.amount);
      out.push(`${a.actor} ${a.action}${amount==null?'':` ${amount}`}`);
    }
  }
  return out;
}

function confidenceOf(d){
  if(!d)return 0;
  if(d.engine==='POLICY V4'&&d.policyProbabilities){
    const p=Math.max(0,...Object.values(d.policyProbabilities).filter(Number.isFinite));
    if(p>0)return Math.round(p*100);
  }
  return CONFIDENCE_PCT[d.confidence]??50;
}

export function postflopPolicyV4Decision(state,context={}){
  const board=Array.isArray(state?.board)?state.board:[];
  if(board.length<3)return null;

  const ledgerHistory=policyHistoryFromLedger(context.ledger);
  const actionHistory=ledgerHistory.length?ledgerHistory:(Array.isArray(state.actionHistory)?state.actionHistory:[]);
  const activePlayers=Number.isFinite(state.activePlayers)
    ? state.activePlayers
    : Number.isFinite(state.players)?state.players:null;

  const analysis=analyzePostflop({
    heroCards:Array.isArray(state.heroCards)?state.heroCards:[],
    board,
    pot:state.pot??null,
    toCall:state.toCall??null,
    legalActions:Array.isArray(state.legalActions)?state.legalActions:[],
    heroPosition:state.heroPosition??null,
    heroStack:state.heroStack??null,
    effectiveStack:state.effectiveStack??null,
    blinds:state.blinds??null,
    activePlayers,
    actionHistory,
    heroInPosition:context.heroInPosition??null,
    heroIsPreflopAggressor:context.heroIsPreflopAggressor??null,
    potType:context.potType??null,
  });

  const d=policyDecision(analysis);
  if(!d||d.action==='ANALISANDO'){
    return {
      decision:null,
      engine:d?.engine??'POLICY V4 GATE',
      reason:d?.reason??'Estado pós-flop insuficiente.',
      confidence:0,
      source:'strategy-v1-frozen',
      details:{analysis,policyProbabilities:d?.policyProbabilities??null,policyAction:d?.action??null},
    };
  }

  return {
    decision:d.label??d.action??null,
    engine:d.engine,
    reason:d.reason,
    confidence:confidenceOf(d),
    source:'strategy-v1-frozen',
    mixed:d.action==='ESTRATÉGIA MISTA',
    details:{
      analysis,
      policyProbabilities:d.policyProbabilities??null,
      policyAction:d.action,
      sizingPct:d.sizingPct??null,
      alternative:d.alternative??null,
      frozenSourceCommit:'3efde306fbb1dda38584cb8ffee0c2245b6231f4',
    },
  };
}
