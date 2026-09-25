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

export function createDecisionNode(input={}){
  const heroCards=Array.isArray(input.heroCards)?input.heroCards.map(String):[];
  const board=Array.isArray(input.board)?input.board.map(String):[];
  const legalActions=[...new Set((Array.isArray(input.legalActions)?input.legalActions:[]).map(upper).filter(Boolean))];
  const node={
    schemaVersion:'cash-pro-lab-node-v1',
    game:'NLHE_CASH_6MAX',
    currency:'BB',
    handId:input.handId??null,
    decisionId:input.decisionId??null,
    heroCards,
    board,
    street:String(input.street||streetFromBoard(board)).toLowerCase(),
    heroPosition:upper(input.heroPosition),
    effectiveStackBB:num(input.effectiveStackBB),
    heroStackBB:num(input.heroStackBB??input.effectiveStackBB),
    potBB:num(input.potBB),
    toCallBB:num(input.toCallBB),
    activePlayers:Number.isInteger(input.activePlayers)?input.activePlayers:null,
    legalActions,
    actionHistory:normalizeHistory(input.actionHistory),
    rakeProfile:input.rakeProfile?String(input.rakeProfile):null,
    opponentModel:input.opponentModel??null,
    evidence:normalizeEvidence(input.evidence),
    assumptions:Array.isArray(input.assumptions)?input.assumptions.map(String):[],
    tags:Array.isArray(input.tags)?input.tags.map(String):[],
  };
  const fingerprintPayload={...node,evidence:node.evidence,decisionId:null};
  node.fingerprint=`cpl-${fnv1a(stableStringify(fingerprintPayload))}`;
  return node;
}

export function isHighImpactNode(node={}){
  const eff=num(node.effectiveStackBB),call=num(node.toCallBB),pot=num(node.potBB);
  const stackFraction=finite(eff)&&eff>0&&finite(call)?call/eff:0;
  const potFraction=finite(pot)&&pot>0&&finite(call)?call/pot:0;
  return node.street==='river'&&call>0 || stackFraction>=0.25 || potFraction>=0.75 || (node.legalActions||[]).includes('ALLIN');
}

export function proveDecisionNode(node={},options={}){
  const errors=[];const warnings=[];
  const hero=Array.isArray(node.heroCards)?node.heroCards:[];
  const board=Array.isArray(node.board)?node.board:[];
  const legal=Array.isArray(node.legalActions)?node.legalActions:[];
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
  if(!finite(node.effectiveStackBB)||node.effectiveStackBB<=0) errors.push('effective_stack_missing');
  if(!finite(node.heroStackBB)||node.heroStackBB<=0) errors.push('hero_stack_missing');
  if(!finite(node.potBB)||node.potBB<=0) errors.push('pot_missing');
  if(!finite(node.toCallBB)||node.toCallBB<0) errors.push('to_call_missing');
  if(finite(node.toCallBB)&&finite(node.heroStackBB)&&node.toCallBB>node.heroStackBB+1e-9) errors.push('to_call_exceeds_stack');
  if(!Number.isInteger(node.activePlayers)||node.activePlayers<2||node.activePlayers>6) errors.push('active_players_invalid');
  if(legal.length<1||legal.some(a=>!ACTIONS.has(a))) errors.push('legal_actions_invalid');
  if(node.toCallBB>0&&legal.includes('CHECK')) errors.push('legal_actions_to_call_inconsistent');
  if(node.toCallBB===0&&legal.includes('CALL')) errors.push('legal_actions_to_call_inconsistent');
  if(history.some(e=>!ACTIONS.has(e.action)||!['preflop','flop','turn','river'].includes(e.street))) errors.push('action_history_invalid');
  if(history.some(e=>finite(e.amountBB)&&e.amountBB<0)) errors.push('action_amount_negative');
  if(options.requireRakeProfile!==false&&!node.rakeProfile) errors.push('rake_profile_missing');

  const critical=['heroCards','board','heroPosition','effectiveStackBB','potBB','toCallBB','activePlayers','legalActions','actionHistory'];
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

  return {
    version:'cash-pro-lab-understanding-proof-v1',
    ok:errors.length===0,
    fingerprint:node.fingerprint??null,
    criticalConfidence:confidences.length?Math.min(...confidences):0,
    highImpact:isHighImpactNode(node),
    errors:[...new Set(errors)],
    warnings:[...new Set(warnings)],
  };
}

export const CASH_PRO_LAB_ACTIONS=[...ACTIONS];
