import { classifyRedZone, proveEconomicConsistency } from './economic-consistency.js';

const ACTIONS=new Set(['FOLD','CHECK','CALL','BET','RAISE','ALLIN']);
const POSITIONS=new Set(['UTG','HJ','CO','BTN','SB','BB']);
const CARD=/^[2-9TJQKA][hdcs]$/;
const BOARD_COUNTS=new Set([0,3,4,5]);
const TRUSTED_SOURCES=new Set(['hand-history','telemetry','replay-verified','manual-verified','solver-fixture']);

const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const upper=(v)=>String(v??'').trim().toUpperCase();
const num=(v)=>{
  if(finite(v)) return v;
  if(typeof v!=='string') return null;
  const n=Number(v.replace(/[^0-9,.-]/g,'').replace(',','.'));
  return Number.isFinite(n)?n:null;
};
const streetFromBoard=(board)=>({0:'preflop',3:'flop',4:'turn',5:'river'})[board.length]||'unknown';
const stableStringify=(value)=>{
  if(Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const fnv1a=(text)=>{
  let h=0x811c9dc5;
  for(let i=0;i<text.length;i++){
    h^=text.charCodeAt(i);
    h=Math.imul(h,0x01000193)>>>0;
  }
  return h.toString(16).padStart(8,'0');
};
const normalizeEvidence=(evidence={})=>Object.fromEntries(Object.entries(evidence||{}).map(([field,row])=>[field,{
  source:String(row?.source||''),
  confidence:finite(row?.confidence)?Math.max(0,Math.min(1,row.confidence)):null,
  observedAt:row?.observedAt??null,
}]));
const normalizeHistory=(history=[])=>Array.isArray(history)?history.map((e,index)=>({
  seq:Number.isInteger(e?.seq)?e.seq:index+1,
  street:String(e?.street||'').toLowerCase(),
  actorPosition:upper(e?.actorPosition||e?.position),
  actorSeat:e?.actorSeat??null,
  action:upper(e?.action),
  amountBB:num(e?.amountBB??e?.amount),
  allIn:e?.allIn===true||upper(e?.action)==='ALLIN',
  source:e?.source??null,
  confidence:finite(e?.confidence)?e.confidence:null,
})):[];

function optionId(action,amountBB,allIn,index){
  if(allIn||action==='ALLIN') return 'ALLIN';
  if(finite(amountBB)&&(action==='BET'||action==='RAISE')) return `${action}:${amountBB.toFixed(4)}`;
  return action||`OPTION-${index+1}`;
}

const normalizeLegalOptions=(inputOptions=[],legalActions=[])=>{
  const source=Array.isArray(inputOptions)&&inputOptions.length
    ? inputOptions
    : legalActions.map(action=>({id:action,action,allIn:action==='ALLIN'}));
  return source.map((row,index)=>{
    const action=upper(row?.action||row?.type||row?.id);
    const amountBB=num(row?.amountBB??row?.amount);
    const allIn=row?.allIn===true||action==='ALLIN';
    return {
      id:String(row?.id||optionId(action,amountBB,allIn,index)),
      action,
      amountBB,
      potFraction:finite(row?.potFraction)?row.potFraction:null,
      allIn,
      source:row?.source?String(row.source):null,
    };
  });
};

function strategicHistory(history=[]){
  return history.map(e=>({
    seq:e.seq,
    street:e.street,
    actorPosition:e.actorPosition,
    action:e.action,
    amountBB:e.amountBB,
    allIn:e.allIn,
  }));
}

function strategicOptions(options=[]){
  return options.map(o=>({
    id:o.id,
    action:o.action,
    amountBB:o.amountBB,
    potFraction:o.potFraction,
    allIn:o.allIn,
  }));
}

function strategicPayload(node={}){
  return {
    fingerprintVersion:'cash-pro-lab-strategic-fingerprint-v3',
    game:node.game,
    currency:node.currency,
    heroCards:node.heroCards,
    board:node.board,
    street:node.street,
    heroPosition:node.heroPosition,
    startingStackBB:node.startingStackBB,
    effectiveStackBB:node.effectiveStackBB,
    heroStackBB:node.heroStackBB,
    potBB:node.potBB,
    toCallBB:node.toCallBB,
    activePlayers:node.activePlayers,
    legalOptions:strategicOptions(node.legalOptions||[]),
    actionHistory:strategicHistory(node.actionHistory||[]),
    rakeProfile:node.rakeProfile,
    strategyProfile:node.strategyProfile??null,
  };
}

export function createDecisionNode(input={}){
  const heroCards=Array.isArray(input.heroCards)?input.heroCards.map(String):[];
  const board=Array.isArray(input.board)?input.board.map(String):[];
  let legalActions=[...new Set((Array.isArray(input.legalActions)?input.legalActions:[]).map(upper).filter(Boolean))];
  const legalOptions=normalizeLegalOptions(input.legalOptions,legalActions);
  legalActions=[...new Set([...legalActions,...legalOptions.map(x=>x.action).filter(Boolean)])];
  const node={
    schemaVersion:'cash-pro-lab-node-v1',
    fingerprintVersion:'cash-pro-lab-strategic-fingerprint-v3',
    game:'NLHE_CASH_6MAX',
    currency:'BB',
    handId:input.handId??null,
    decisionId:input.decisionId??null,
    heroCards,
    board,
    street:String(input.street||streetFromBoard(board)).toLowerCase(),
    heroPosition:upper(input.heroPosition),
    startingStackBB:num(input.startingStackBB??input.effectiveStackBB),
    effectiveStackBB:num(input.effectiveStackBB),
    heroStackBB:num(input.heroStackBB??input.effectiveStackBB),
    potBB:num(input.potBB),
    toCallBB:num(input.toCallBB),
    activePlayers:Number.isInteger(input.activePlayers)?input.activePlayers:null,
    legalActions,
    legalOptions,
    actionHistory:normalizeHistory(input.actionHistory),
    rakeProfile:input.rakeProfile?String(input.rakeProfile):null,
    strategyProfile:input.strategyProfile?String(input.strategyProfile):null,
    opponentModel:input.opponentModel??null,
    evidence:normalizeEvidence(input.evidence),
    assumptions:Array.isArray(input.assumptions)?input.assumptions.map(String):[],
    tags:Array.isArray(input.tags)?input.tags.map(String):[],
  };
  node.fingerprint=`cpl3-${fnv1a(stableStringify(strategicPayload(node)))}`;
  const observationPayload={
    fingerprintVersion:'cash-pro-lab-observation-fingerprint-v1',
    strategicFingerprint:node.fingerprint,
    handId:node.handId,
    decisionId:node.decisionId,
    evidence:node.evidence,
    assumptions:node.assumptions,
    tags:node.tags,
    opponentModel:node.opponentModel,
  };
  node.observationFingerprint=`cplo-${fnv1a(stableStringify(observationPayload))}`;
  return node;
}

export function isHighImpactNode(node={}){
  const eff=num(node.effectiveStackBB),call=num(node.toCallBB),pot=num(node.potBB);
  const stackFraction=finite(eff)&&eff>0&&finite(call)?call/eff:0;
  const potFraction=finite(pot)&&pot>0&&finite(call)?call/pot:0;
  return node.street==='river'&&call>0 || stackFraction>=0.25 || potFraction>=0.75 || (node.legalActions||[]).includes('ALLIN') || (node.legalOptions||[]).some(o=>o?.allIn===true);
}

export function proveDecisionNode(node={},options={}){
  const errors=[];const warnings=[];
  const hero=Array.isArray(node.heroCards)?node.heroCards:[];
  const board=Array.isArray(node.board)?node.board:[];
  const legal=Array.isArray(node.legalActions)?node.legalActions:[];
  const legalOptions=Array.isArray(node.legalOptions)?node.legalOptions:[];
  const history=Array.isArray(node.actionHistory)?node.actionHistory:[];
  const allCards=[...hero,...board];

  if(node.schemaVersion!=='cash-pro-lab-node-v1') errors.push('schema_invalid');
  if(node.game!=='NLHE_CASH_6MAX') errors.push('game_not_cash_6max');
  if(node.currency!=='BB') errors.push('currency_not_bb');
  if(hero.length!==2||hero.some(c=>!CARD.test(c))) errors.push('hero_cards_incomplete');
  if(!BOARD_COUNTS.has(board.length)||board.some(c=>!CARD.test(c))) errors.push('board_invalid');
  if(new Set(allCards).size!==allCards.length) errors.push('duplicate_card');
  if(node.street!==streetFromBoard(board)) errors.push('street_board_mismatch');
  if(!POSITIONS.has(node.heroPosition)) errors.push('hero_position_missing');
  if(!finite(node.startingStackBB)||node.startingStackBB<=0) errors.push('starting_stack_missing');
  if(!finite(node.effectiveStackBB)||node.effectiveStackBB<=0) errors.push('effective_stack_missing');
  if(finite(node.startingStackBB)&&finite(node.effectiveStackBB)&&node.effectiveStackBB>node.startingStackBB+1e-9) errors.push('effective_stack_exceeds_starting_stack');
  if(!finite(node.heroStackBB)||node.heroStackBB<=0) errors.push('hero_stack_missing');
  if(!finite(node.potBB)||node.potBB<=0) errors.push('pot_missing');
  if(!finite(node.toCallBB)||node.toCallBB<0) errors.push('to_call_missing');
  if(finite(node.toCallBB)&&finite(node.heroStackBB)&&node.toCallBB>node.heroStackBB+1e-9) errors.push('to_call_exceeds_stack');
  if(!Number.isInteger(node.activePlayers)||node.activePlayers<2||node.activePlayers>6) errors.push('active_players_invalid');
  if(legal.length<1||legal.some(a=>!ACTIONS.has(a))) errors.push('legal_actions_invalid');
  if(legalOptions.length<1) errors.push('legal_options_missing');
  if(legalOptions.some(o=>!o||!o.id||!ACTIONS.has(o.action))) errors.push('legal_options_invalid');
  if(new Set(legalOptions.map(o=>o.id)).size!==legalOptions.length) errors.push('legal_option_id_duplicate');
  if(legalOptions.some(o=>!legal.includes(o.action))) errors.push('legal_option_action_mismatch');
  if(legalOptions.some(o=>finite(o.amountBB)&&o.amountBB<0)) errors.push('legal_option_amount_negative');
  if(node.toCallBB>0&&legal.includes('CHECK')) errors.push('legal_actions_to_call_inconsistent');
  if(node.toCallBB===0&&legal.includes('CALL')) errors.push('legal_actions_to_call_inconsistent');
  if(history.some(e=>!ACTIONS.has(e.action)||!['preflop','flop','turn','river'].includes(e.street))) errors.push('action_history_invalid');
  if(history.some(e=>finite(e.amountBB)&&e.amountBB<0)) errors.push('action_amount_negative');
  if(options.requireRakeProfile!==false&&!node.rakeProfile) errors.push('rake_profile_missing');
  if(options.requireStrategyProfile===true&&!node.strategyProfile) errors.push('strategy_profile_missing');

  if(options.requireSizedAggression===true){
    const aggressive=legalOptions.filter(o=>['BET','RAISE','ALLIN'].includes(o.action));
    if(aggressive.some(o=>!o.allIn&&!finite(o.amountBB))) errors.push('aggressive_sizing_missing');
    const byAction=new Map();
    for(const o of aggressive){const a=byAction.get(o.action)||[];a.push(o);byAction.set(o.action,a);}
    for(const rows of byAction.values()) if(rows.length>1&&rows.some(o=>!o.allIn&&!finite(o.amountBB))) errors.push('legal_option_sizing_ambiguous');
  }

  const critical=['heroCards','board','heroPosition','effectiveStackBB','potBB','toCallBB','activePlayers','legalActions','actionHistory'];
  if(options.requireStartingStackEvidence===true) critical.push('startingStackBB');
  if(options.requireLegalOptionsEvidence===true) critical.push('legalOptions');
  const confidences=[];
  for(const field of critical){
    const ev=node.evidence?.[field];
    if(!ev||!TRUSTED_SOURCES.has(ev.source)||!finite(ev.confidence)) errors.push(`evidence_missing:${field}`);
    else {
      confidences.push(ev.confidence);
      if(ev.confidence<(options.minEvidenceConfidence??0.90)) errors.push(`evidence_low_confidence:${field}`);
    }
  }
  if(node.assumptions?.length) warnings.push('contains_assumptions');
  if(isHighImpactNode(node)&&node.assumptions?.length) errors.push('high_impact_assumptions_not_allowed');

  const redZone=classifyRedZone(node);
  const economicRequired=options.requireEconomicConsistency===true || (options.requireEconomicConsistencyForRedZone===true&&redZone.redZone);
  const economicProof=(economicRequired||options.economicContext)
    ? proveEconomicConsistency(node,options.economicContext||{})
    : null;
  if(economicRequired&&economicProof&&!economicProof.ok){
    for(const error of economicProof.errors) errors.push(`economic:${error}`);
  }

  return {
    version:'cash-pro-lab-understanding-proof-v1',
    ok:errors.length===0,
    fingerprint:node.fingerprint??null,
    observationFingerprint:node.observationFingerprint??null,
    criticalConfidence:confidences.length?Math.min(...confidences):0,
    highImpact:isHighImpactNode(node),
    redZone,
    economicProof,
    exactSizingReady:errors.includes('aggressive_sizing_missing')===false&&errors.includes('legal_option_sizing_ambiguous')===false,
    errors:[...new Set(errors)],
    warnings:[...new Set(warnings)],
  };
}

export function resolveLegalChoice(node={},choice={}){
  const options=Array.isArray(node.legalOptions)?node.legalOptions:[];
  const choiceId=String(choice?.choiceId||choice?.id||'');
  if(choiceId){
    const exact=options.find(o=>o.id===choiceId);
    if(exact) return exact;
  }
  const action=upper(choice?.action);
  const candidates=options.filter(o=>o.action===action);
  if(candidates.length===1) return candidates[0];
  if(candidates.length>1&&finite(choice?.amountBB)){
    return candidates.find(o=>finite(o.amountBB)&&Math.abs(o.amountBB-choice.amountBB)<1e-6)||null;
  }
  return null;
}

export function strategicFingerprintPayload(node={}){
  return strategicPayload(node);
}

export const CASH_PRO_LAB_ACTIONS=[...ACTIONS];
