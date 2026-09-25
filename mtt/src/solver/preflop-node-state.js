import {normalizePosition} from '../core/positions.js';
import {preflopActionEconomics} from './preflop-economics.js';

const EPS=1e-9;
const actionCode=a=>String(a?.action||'').trim().toUpperCase();
const isCall=a=>actionCode(a)==='CALL'||(actionCode(a)==='ALLIN'&&a?.allInCall===true);
const isAggression=a=>['RAISE','ALLIN'].includes(actionCode(a))&&a?.allInCall!==true&&Number(a?.raiseSizeBB||0)>EPS;

function indexAggressions(history=[]){
 const out=[];
 for(let i=0;i<history.length;i++)if(isAggression(history[i]))out.push({index:i,...history[i]});
 return out;
}

function callsBeforeFirstRaise(history=[],firstRaiseIndex=Infinity,bigBlindBB=1){
 return history.filter((a,i)=>i<firstRaiseIndex&&isCall(a)&&Number(a?.amountToBB||0)<=Number(bigBlindBB)+EPS).map(a=>normalizePosition(a.position));
}

function callsAfterFirstRaise(history=[],firstRaiseIndex=Infinity){
 return history.filter((a,i)=>i>firstRaiseIndex&&isCall(a)).map(a=>normalizePosition(a.position));
}

function heroRole({hero,history,aggressions,limpers}){
 const own=history.filter(a=>normalizePosition(a.position)===hero);
 if(!own.length)return 'UNACTED';
 if(aggressions.some(a=>normalizePosition(a.position)===hero))return 'AGGRESSOR';
 if(limpers.includes(hero))return 'LIMPER';
 if(own.some(isCall))return 'CALLER';
 return actionCode(own.at(-1))||'ACTED';
}

function nodeFor({hero,econ,aggressions,limpers,callsAfter,history}){
 const raises=aggressions.length;
 const own=history.filter(a=>normalizePosition(a.position)===hero);
 const lastAgg=aggressions.at(-1)||null;
 const firstAgg=aggressions[0]||null;
 const heroAgg=aggressions.filter(a=>normalizePosition(a.position)===hero);
 const heroCalledAfterOpen=firstAgg?history.some((a,i)=>i>firstAgg.index&&normalizePosition(a.position)===hero&&isCall(a)):false;
 const heroLimped=limpers.includes(hero);
 const coldCallers=callsAfter.filter(p=>p!==hero);

 if(raises===0){
  if(limpers.length)return econ.canCheck&&hero==='BB'?'BB_VS_LIMPERS_OPTION':'VS_LIMPERS';
  return 'UNOPENED';
 }

 if(raises===1){
  if(normalizePosition(lastAgg.position)===hero)return 'OPEN_RETURN_NO_PRICE';
  if(!own.length)return coldCallers.length?'SQUEEZE_OPPORTUNITY':'VS_OPEN';
  if(heroLimped)return 'LIMP_VS_RAISE';
  if(heroCalledAfterOpen)return 'CALL_RETURN_NO_NEW_RAISE';
  return 'VS_OPEN';
 }

 if(raises===2){
  const second=aggressions[1];
  if(normalizePosition(second.position)===hero)return 'THREEBET_RETURN_NO_PRICE';
  if(normalizePosition(firstAgg.position)===hero){
   if(second.fullRaise===false&&!econ.raiseRightOpen)return 'VS_SHORT_3BET_NOT_REOPENED';
   if(second.fullRaise===false)return 'VS_SHORT_3BET';
   return 'VS_3BET';
  }
  if(heroCalledAfterOpen)return 'CALLER_VS_SQUEEZE';
  if(heroLimped)return 'LIMPER_VS_3BET';
  if(!own.length)return 'COLD_VS_3BET';
  return 'VS_3BET';
 }

 if(raises===3){
  const third=aggressions[2];
  const second=aggressions[1];
  if(normalizePosition(third.position)===hero)return 'FOURBET_RETURN_NO_PRICE';
  if(normalizePosition(second.position)===hero||heroAgg.length)return 'VS_4BET';
  if(!own.length)return 'COLD_VS_4BET';
  return 'VS_4BET';
 }

 if(normalizePosition(lastAgg.position)===hero)return 'AGGRESSION_RETURN_NO_PRICE';
 return 'VS_5BET_PLUS';
}

export function preflopNodeState(state,heroPosition){
 const hero=normalizePosition(heroPosition),player=state?.players?.[hero];
 if(!player)throw new Error(`preflop_node_player_unknown:${heroPosition}`);
 const history=[...(state.history||[])],econ=preflopActionEconomics(state,hero),aggressions=indexAggressions(history),firstRaiseIndex=aggressions[0]?.index??Infinity,bigBlindBB=Number(state?.forced?.bigBlindBB||1),limpers=callsBeforeFirstRaise(history,firstRaiseIndex,bigBlindBB),callsAfter=callsAfterFirstRaise(history,firstRaiseIndex),lastAgg=aggressions.at(-1)||null;
 const active=player.active!==false&&player.folded!==true&&!player.allIn;
 const node=active?nodeFor({hero,econ,aggressions,limpers,callsAfter,history}):'NO_DECISION_INACTIVE';
 const pressureLevel=aggressions.length===0?0:Math.min(5,aggressions.length);
 return{
  schema:'ssj-mtt-preflop-node-state-v1',
  heroPosition:hero,
  node,
  active,
  heroRole:heroRole({hero,history,aggressions,limpers}),
  pressureLevel,
  aggressionCount:aggressions.length,
  fullRaiseCount:aggressions.filter(a=>a.fullRaise===true).length,
  shortRaiseCount:aggressions.filter(a=>a.fullRaise===false).length,
  firstAggressor:aggressions[0]?normalizePosition(aggressions[0].position):null,
  lastAggressor:lastAgg?normalizePosition(lastAgg.position):null,
  lastAggressionWasFullRaise:lastAgg?lastAgg.fullRaise===true:null,
  limpers:[...limpers],
  coldCallersAfterOpen:callsAfter.filter(p=>p!==hero),
  economics:{
   potBB:Number(state.potBB),currentBetBB:Number(state.currentBetBB),toCallBB:econ.toCallBB,rawToCallBB:econ.rawToCallBB,minFullRaiseToBB:econ.minFullRaiseToBB,maxRaiseToBB:econ.maxRaiseToBB,canCheck:econ.canCheck,canCall:econ.canCall,canRaise:econ.canRaise,callIsAllIn:econ.callIsAllIn,raiseRightOpen:econ.raiseRightOpen,raiseGeneration:econ.raiseGeneration,actedGeneration:econ.actedGeneration
  }
 };
}

export function preflopNodeKey(state,heroPosition){
 const n=preflopNodeState(state,heroPosition);return `${n.node}|${n.heroPosition}|p${n.pressureLevel}|${n.economics.raiseRightOpen?'R':'NR'}`;
}
