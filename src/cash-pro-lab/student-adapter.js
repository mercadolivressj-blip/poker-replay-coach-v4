import { decideBrain } from '../brain/decision.js';

const aggressive=(a)=>['BET','RAISE','ALLIN'].includes(a);

function buildExternalLedger(node={}){
  const actions=(Array.isArray(node.actionHistory)?node.actionHistory:[]).map((e,index)=>{
    const actor=e.actorPosition||e.actorSeat||null;
    return {
      seq:Number.isInteger(e.seq)?e.seq:index+1,
      street:e.street,
      actor,
      action:e.action,
      amount:e.amountBB??null,
      toAmount:null,
      allIn:e.allIn===true||e.action==='ALLIN',
      raw:[actor,e.action,e.amountBB??''].filter(v=>v!==null&&v!=='').join(' '),
    };
  });
  let preflopAggressor=null,lastAggressor=null;
  const players=new Set();
  for(const a of actions){
    if(a.actor) players.add(a.actor);
    if(aggressive(a.action)){
      lastAggressor=a.actor;
      if(a.street==='preflop') preflopAggressor=a.actor;
    }
  }
  return {
    version:'action-ledger-v1-external',
    handId:node.handId??null,
    heroActor:node.heroPosition??'HERO',
    seats:[],
    actions,
    seen:[],
    street:node.street||'preflop',
    preflopAggressor,
    lastAggressor,
    playersSeen:[...players],
  };
}

function stateFromNode(node={}){
  return {
    heroCards:[...(node.heroCards||[])],
    board:[...(node.board||[])],
    pot:node.potBB,
    toCall:node.toCallBB,
    heroStack:node.heroStackBB,
    effectiveStack:node.effectiveStackBB,
    heroPosition:node.heroPosition,
    activePlayers:node.activePlayers,
    legalActions:[...(node.legalActions||[])],
    actionHistory:(node.actionHistory||[]).map(e=>[e.actorPosition||e.actorSeat||'?',e.action,e.amountBB??''].filter(Boolean).join(' ')),
    capturedAt:null,
  };
}

export function createCashBrainStudent({brain=decideBrain,studentId='cash-brain-student-v1'}={}){
  if(typeof brain!=='function') throw new TypeError('brain must be a function');
  return async function runCashBrainStudent(node={}){
    const state=stateFromNode(node);
    const ledger=buildExternalLedger(node);
    const result=await brain(state,{
      format:'cash',
      handId:node.handId??null,
      heroActor:node.heroPosition??'HERO',
      ledger,
      effectiveStackBB:node.effectiveStackBB,
      rakeProfile:node.rakeProfile,
      labMode:true,
    });
    if(result?.mixed===true||result?.actionCode==='MIXED'){
      const mix=result?.actionMix;
      const validMix=mix&&typeof mix==='object'&&Object.keys(mix).length>=2;
      if(!validMix){
        return {
          studentId,
          blocked:true,
          reason:'mixed_strategy_weights_missing',
          action:null,
          raw:result,
        };
      }
      return {studentId,blocked:false,action:null,actionMix:{...mix},confidence:result.confidence??0,engine:result.engine??null,reason:result.reason??null,raw:result};
    }
    if(!result?.actionCode){
      return {studentId,blocked:true,reason:'brain_returned_no_action',action:null,raw:result};
    }
    return {
      studentId,
      blocked:false,
      action:result.actionCode,
      confidence:result.confidence??0,
      engine:result.engine??null,
      reason:result.reason??null,
      raw:result,
    };
  };
}

export { buildExternalLedger, stateFromNode };
