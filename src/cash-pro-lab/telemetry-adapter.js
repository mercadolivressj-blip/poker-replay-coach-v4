import { createDecisionNode, proveDecisionNode } from './decision-node.js';

const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const num=(v)=>{
  if(finite(v)) return v;
  if(typeof v!=='string') return null;
  const m=v.match(/-?\d+(?:[.,]\d+)?/g);if(!m?.length) return null;
  const n=Number(m.at(-1).replace(',','.'));return Number.isFinite(n)?n:null;
};
const parseBB=(snapshot={},options={})=>{
  const explicit=num(options.bigBlind??snapshot.bigBlind??snapshot.bb);
  if(finite(explicit)&&explicit>0) return explicit;
  const blinds=String(snapshot.blinds||'').match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/);
  if(!blinds) return null;
  const bb=Number(blinds[2].replace(',','.'));
  return Number.isFinite(bb)&&bb>0?bb:null;
};
const toBB=(v,bb)=>{const n=num(v);return finite(n)&&finite(bb)&&bb>0?n/bb:null};
const streetFromBoard=(board)=>({0:'preflop',3:'flop',4:'turn',5:'river'})[Array.isArray(board)?board.length:-1]||null;
const actionEventsForTurn=(payload,turn)=>{
  const events=Array.isArray(payload?.events)?payload.events:[];
  return events.filter(e=>e?.type==='action'&&e.handId===turn.handId&&(e.mediaTime??Infinity)<=(turn.mediaTime??Infinity)).map((e,index)=>({
    seq:index+1,
    street:String(e.street||'').toLowerCase(),
    actorSeat:e.seatId??null,
    actorPosition:e.actorPosition??null,
    action:e.action,
    amount:e.amount,
    allIn:e.action==='ALLIN'||e.allIn===true,
    source:'telemetry',
    confidence:finite(e.confidence)?e.confidence:null,
  }));
};
const validatedFlag=(turn,snapshot,decision)=>Boolean(
  turn?.validation?.ok===true||turn?.validationOk===true||snapshot?.validation?.ok===true||decision?.validation?.ok===true
);
const confidenceFor=(validated)=>validated?0.99:0.85;
const evidence=(validated)=>Object.fromEntries(
  ['heroCards','board','heroPosition','effectiveStackBB','potBB','toCallBB','activePlayers','legalActions','actionHistory']
    .map(field=>[field,{source:'telemetry',confidence:confidenceFor(validated)}])
);

export function telemetryTurnsToDecisionNodes(payload={},options={}){
  const turns=Array.isArray(payload.turns)?payload.turns:[];
  const decisions=Array.isArray(payload.decisions)?payload.decisions:[];
  return turns.map((turn,index)=>{
    const decision=decisions.find(d=>d?.handId===turn?.handId&&d?.epoch===turn?.epoch)||null;
    const snapshot=turn?.snapshot||decision?.snapshot||turn?.state||{};
    const state=snapshot?.state&&typeof snapshot.state==='object'?snapshot.state:snapshot;
    const board=Array.isArray(state.board)?state.board:[];
    const bb=parseBB(state,options);
    const validated=validatedFlag(turn,snapshot,decision);
    const structuredActions=Array.isArray(snapshot.actions)?snapshot.actions:actionEventsForTurn(payload,turn);
    const activePlayers=Number.isInteger(state.activePlayers)?state.activePlayers:
      Number.isInteger(snapshot.activePlayers)?snapshot.activePlayers:
      Array.isArray(snapshot.activeSeats)?snapshot.activeSeats.length:null;
    const effectiveRaw=num(state.effectiveStack??snapshot.effectiveStack);
    const heroStackRaw=num(state.heroStack??snapshot.heroStack);
    const effectiveStackBB=finite(effectiveRaw)?toBB(effectiveRaw,bb):toBB(heroStackRaw,bb);
    const input={
      handId:turn.handId??null,
      decisionId:`telemetry-${turn.handId??'unknown'}-${turn.epoch??index+1}`,
      heroCards:Array.isArray(state.heroCards)?state.heroCards:[],
      board,
      street:String(turn.street||state.street||streetFromBoard(board)||'').toLowerCase(),
      heroPosition:state.heroPosition??snapshot.heroPosition??null,
      effectiveStackBB,
      heroStackBB:toBB(heroStackRaw,bb),
      potBB:toBB(state.pot??snapshot.pot,bb),
      toCallBB:toBB(state.toCall??snapshot.toCall,bb),
      activePlayers,
      legalActions:Array.isArray(state.legalActions)?state.legalActions:(snapshot.legalActions||[]),
      actionHistory:structuredActions.map((a,seq)=>({
        seq:seq+1,street:String(a.street||'').toLowerCase(),actorPosition:a.actorPosition??null,actorSeat:a.seatId??a.actorSeat??null,
        action:a.action,amountBB:toBB(a.amountBB??a.amount,bb),allIn:a.allIn===true||a.action==='ALLIN',source:'telemetry',confidence:a.confidence??null,
      })),
      rakeProfile:options.rakeProfile??state.rakeProfile??snapshot.rakeProfile??null,
      evidence:evidence(validated),
      assumptions:[],
      tags:['telemetry-import',validated?'runtime-validated':'runtime-unvalidated'],
    };
    const node=createDecisionNode(input);
    const proof=proveDecisionNode(node,options.proofOptions||{});
    const adapterErrors=[];
    if(!finite(bb)||bb<=0) adapterErrors.push('big_blind_missing');
    if(!validated) adapterErrors.push('runtime_validation_missing');
    return {
      version:'cash-pro-lab-telemetry-adapter-v1',
      handId:turn.handId??null,
      epoch:turn.epoch??null,
      mediaTime:turn.mediaTime??null,
      bigBlind:bb,
      runtimeValidated:validated,
      node,
      proof,
      adapterErrors,
    };
  });
}
