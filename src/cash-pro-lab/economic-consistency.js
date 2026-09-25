const STREETS=['preflop','flop','turn','river'];
const POSITIONS=new Set(['UTG','HJ','CO','BTN','SB','BB']);
const ACTIONS=new Set(['FOLD','CHECK','CALL','BET','RAISE','ALLIN']);

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const upper=v=>String(v??'').trim().toUpperCase();
const lower=v=>String(v??'').trim().toLowerCase();
const round=v=>Number(Number(v).toFixed(8));

function cloneCommitments(input={}){
  const out={};
  for(const [rawPosition,rawAmount] of Object.entries(input||{})){
    const position=upper(rawPosition),amount=Number(rawAmount);
    if(POSITIONS.has(position)&&finite(amount)&&amount>=0) out[position]=amount;
  }
  return out;
}

function maxCommitment(commitments={}){
  const values=Object.values(commitments).filter(finite);
  return values.length?Math.max(...values):0;
}

function amountDelta(event){
  if(['CHECK','FOLD'].includes(event.action)) return 0;
  return finite(event.amountBB)?event.amountBB:null;
}

export function classifyRedZone(node={}){
  const street=lower(node.street);
  const pot=Number(node.potBB),call=Number(node.toCallBB),stack=Number(node.heroStackBB??node.effectiveStackBB),eff=Number(node.effectiveStackBB);
  const legalActions=Array.isArray(node.legalActions)?node.legalActions.map(upper):[];
  const legalOptions=Array.isArray(node.legalOptions)?node.legalOptions:[];
  const reasons=[];
  const callPot=finite(call)&&call>0&&finite(pot)&&pot>0?call/pot:0;
  const callStack=finite(call)&&call>0&&finite(stack)&&stack>0?call/stack:0;
  const callEff=finite(call)&&call>0&&finite(eff)&&eff>0?call/eff:0;
  const allinAvailable=legalActions.includes('ALLIN')||legalOptions.some(o=>o?.allIn===true||upper(o?.action)==='ALLIN');

  if(allinAvailable) reasons.push('allin_available');
  if(street==='river'&&call>0) reasons.push('river_facing_call');
  if(callPot>=1) reasons.push('call_at_least_pot');
  else if(callPot>=0.75) reasons.push('call_at_least_75pct_pot');
  if(callStack>=0.5) reasons.push('call_at_least_half_hero_stack');
  if(callEff>=0.25) reasons.push('call_at_least_quarter_effective_stack');

  let level='STANDARD';
  if(reasons.includes('allin_available')||reasons.includes('call_at_least_pot')||reasons.includes('call_at_least_half_hero_stack')) level='CRITICAL';
  else if(reasons.length) level='HIGH';

  return {
    version:'cash-pro-lab-red-zone-v1',
    level,
    redZone:level!=='STANDARD',
    reasons,
    metrics:{
      callToPotRatio:round(callPot),
      callToHeroStackRatio:round(callStack),
      callToEffectiveStackRatio:round(callEff),
    },
  };
}

export function proveEconomicConsistency(node={},context={}){
  const errors=[];const warnings=[];
  const tolerance=finite(context?.toleranceBB)&&context.toleranceBB>0?context.toleranceBB:1e-6;
  const history=Array.isArray(node.actionHistory)?node.actionHistory:[];
  const initialPotBB=Number(context?.initialPotBB);
  const amountSemantics=String(context?.amountSemantics||'');
  const potSemantics=String(context?.potSemantics||'');
  const opening=context?.openingCommitmentsByStreet&&typeof context.openingCommitmentsByStreet==='object'
    ? context.openingCommitmentsByStreet:{};
  const exactContext=finite(initialPotBB)&&initialPotBB>=0&&amountSemantics==='delta'&&potSemantics==='includes-history-contributions';

  if(!finite(initialPotBB)||initialPotBB<0) errors.push('initial_pot_missing');
  if(amountSemantics!=='delta') errors.push('amount_semantics_not_delta');
  if(potSemantics!=='includes-history-contributions') errors.push('pot_semantics_unsupported');
  if(!history.length) warnings.push('history_empty');

  let pot=finite(initialPotBB)?initialPotBB:0;
  let streetIndex=-1;
  let commitments={};
  const terminalActors=new Map();
  let previousSeq=-Infinity;

  const enterStreet=nextStreet=>{
    streetIndex=STREETS.indexOf(nextStreet);
    commitments=cloneCommitments(opening?.[nextStreet]||{});
  };

  for(let i=0;i<history.length;i++){
    const e=history[i]||{};
    const eventStreet=lower(e.street),eventStreetIndex=STREETS.indexOf(eventStreet);
    const actor=upper(e.actorPosition),action=upper(e.action);
    const seq=Number(e.seq);
    if(eventStreetIndex<0){errors.push(`history_street_invalid:${i}`);continue;}
    if(eventStreetIndex<streetIndex) errors.push(`history_street_regression:${i}`);
    if(eventStreetIndex!==streetIndex) enterStreet(eventStreet);
    if(!POSITIONS.has(actor)) errors.push(`history_actor_invalid:${i}`);
    if(!ACTIONS.has(action)) errors.push(`history_action_invalid:${i}`);
    if(!finite(seq)||seq<=previousSeq) errors.push(`history_sequence_not_strict:${i}`);
    if(finite(seq)) previousSeq=seq;
    if(terminalActors.has(actor)) errors.push(`actor_acted_after_${terminalActors.get(actor)}:${actor}:${i}`);

    const before=commitments[actor]??0;
    const maxBefore=maxCommitment(commitments);
    const facing=Math.max(0,maxBefore-before);
    const delta=amountDelta({...e,action});

    if(['CALL','BET','RAISE','ALLIN'].includes(action)&&delta==null) errors.push(`action_amount_missing:${i}`);
    if(delta!=null&&delta<0) errors.push(`action_amount_negative:${i}`);
    if(action==='CHECK'&&facing>tolerance) errors.push(`check_facing_bet:${i}`);
    if(action==='CALL'&&Math.abs((delta??0)-facing)>tolerance) errors.push(`call_amount_mismatch:${i}`);
    if(action==='BET'&&facing>tolerance) errors.push(`bet_while_facing_bet:${i}`);
    if(action==='RAISE'&&facing<=tolerance) errors.push(`raise_without_facing_bet:${i}`);

    if(delta!=null&&delta>0){
      const after=before+delta;
      if(action==='RAISE'&&after<=maxBefore+tolerance) errors.push(`raise_does_not_exceed_current_commitment:${i}`);
      commitments[actor]=after;
      pot+=delta;
    }

    if(action==='FOLD') terminalActors.set(actor,'fold');
    if(action==='ALLIN'||e.allIn===true) terminalActors.set(actor,'allin');
  }

  const nodeStreet=lower(node.street);
  const nodeStreetIndex=STREETS.indexOf(nodeStreet);
  if(nodeStreetIndex<0) errors.push('node_street_invalid');
  if(streetIndex>nodeStreetIndex) errors.push('history_extends_beyond_node_street');
  if(streetIndex!==nodeStreetIndex) enterStreet(nodeStreet);

  const hero=upper(node.heroPosition);
  const heroCommitted=commitments[hero]??0;
  const currentMax=maxCommitment(commitments);
  const rawToCall=Math.max(0,currentMax-heroCommitted);
  const heroStack=Number(node.heroStackBB);
  const expectedToCall=finite(heroStack)&&heroStack>=0?Math.min(rawToCall,heroStack):rawToCall;

  if(finite(node.potBB)&&Math.abs(node.potBB-pot)>tolerance) errors.push('pot_reconstruction_mismatch');
  else if(!finite(node.potBB)) errors.push('node_pot_missing');
  if(finite(node.toCallBB)&&Math.abs(node.toCallBB-expectedToCall)>tolerance) errors.push('to_call_reconstruction_mismatch');
  else if(!finite(node.toCallBB)) errors.push('node_to_call_missing');
  if(terminalActors.has(hero)) errors.push(`hero_terminal_before_decision:${terminalActors.get(hero)}`);

  const redZone=classifyRedZone(node);
  return {
    version:'cash-pro-lab-economic-consistency-proof-v1',
    ok:errors.length===0,
    exact:exactContext,
    redZone,
    reconstructed:{
      potBB:round(pot),
      toCallBB:round(expectedToCall),
      currentStreet:nodeStreet,
      currentStreetCommitmentsBB:Object.fromEntries(Object.entries(commitments).map(([k,v])=>[k,round(v)])),
    },
    context:{
      initialPotBB:finite(initialPotBB)?initialPotBB:null,
      amountSemantics:amountSemantics||null,
      potSemantics:potSemantics||null,
      toleranceBB:tolerance,
    },
    errors:[...new Set(errors)],
    warnings:[...new Set(warnings)],
  };
}
