import {positionsFor,normalizePosition} from '../core/positions.js';

const EPS=1e-9;
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const round=x=>Number(Number(x).toFixed(12));
const clonePlayers=players=>Object.fromEntries(Object.entries(players).map(([p,x])=>[p,{...x}]));

function stackMap(positions,stacksBB,defaultStackBB){
 const out={};
 for(const p of positions){
  const x=typeof stacksBB==='number'?Number(stacksBB):Number(stacksBB?.[p]??defaultStackBB);
  if(!(x>0))throw new Error(`preflop_stack_invalid:${p}`);out[p]=x;
 }
 return out;
}

export function createPreflopEconomy({tableSize=8,stacksBB=null,defaultStackBB=40,smallBlindBB=.5,bigBlindBB=1,anteBB=0,anteType='individual'}={}){
 const positions=positionsFor(tableSize),sb=n(smallBlindBB),bb=n(bigBlindBB),ante=n(anteBB),type=String(anteType||'individual').toLowerCase();
 if(!(sb>0)||!(bb>sb)||ante<0)throw new Error('preflop_forced_bets_invalid');
 if(!['individual','big_blind'].includes(type))throw new Error('preflop_ante_type_invalid');
 const stacks=stackMap(positions,stacksBB,defaultStackBB),players={};
 for(const p of positions){
  const antePaid=type==='individual'?ante:(p==='BB'?ante:0),live=p==='SB'?sb:(p==='BB'?bb:0),total=antePaid+live;
  if(total>stacks[p]+EPS)throw new Error(`preflop_forced_exceeds_stack:${p}`);
  players[p]={position:p,startStackBB:stacks[p],anteBB:antePaid,liveCommitBB:live,totalCommitBB:total,behindBB:round(stacks[p]-total),active:true,allIn:Math.abs(stacks[p]-total)<=EPS,folded:false};
 }
 const potBB=round(Object.values(players).reduce((s,x)=>s+x.totalCommitBB,0));
 return{schema:'ssj-mtt-preflop-economy-v1',tableSize:Number(tableSize),positions,forced:{smallBlindBB:sb,bigBlindBB:bb,anteBB:ante,anteType:type},players,currentBetBB:bb,lastFullRaiseSizeBB:bb,potBB,actionSeq:0,history:[]};
}

export function preflopActionEconomics(state,position){
 const p=normalizePosition(position),x=state?.players?.[p];if(!x)throw new Error(`preflop_player_unknown:${position}`);
 const toCall=Math.max(0,round(state.currentBetBB-x.liveCommitBB)),maxRaiseTo=round(x.liveCommitBB+x.behindBB),minFullRaiseTo=round(state.currentBetBB+state.lastFullRaiseSizeBB);
 return{position:p,toCallBB:Math.min(toCall,x.behindBB),rawToCallBB:toCall,maxRaiseToBB:maxRaiseTo,minFullRaiseToBB:minFullRaiseTo,canCheck:toCall<=EPS,canCall:x.active&&!x.allIn&&toCall>EPS&&x.behindBB>0,canRaise:x.active&&!x.allIn&&maxRaiseTo>state.currentBetBB+EPS,callIsAllIn:toCall>=x.behindBB-EPS};
}

function addContribution(state,x,liveDelta){
 const d=Math.max(0,round(liveDelta));if(d>x.behindBB+EPS)throw new Error('preflop_contribution_exceeds_stack');
 x.liveCommitBB=round(x.liveCommitBB+d);x.totalCommitBB=round(x.totalCommitBB+d);x.behindBB=round(x.behindBB-d);if(x.behindBB<=EPS){x.behindBB=0;x.allIn=true}state.potBB=round(state.potBB+d);
}

export function applyPreflopAction(input,action={}){
 const state={...input,players:clonePlayers(input.players),history:[...(input.history||[])]},p=normalizePosition(action.position),x=state.players[p];
 if(!x)throw new Error(`preflop_player_unknown:${action.position}`);if(!x.active||x.folded)throw new Error(`preflop_player_inactive:${p}`);if(x.allIn)throw new Error(`preflop_player_allin:${p}`);
 const code=String(action.action||'').toUpperCase().replace('-',''),econ=preflopActionEconomics(state,p);let fullRaise=false,raiseSize=0,amountTo=null;
 if(code==='FOLD'){x.active=false;x.folded=true}
 else if(code==='CHECK'){
  if(!econ.canCheck)throw new Error(`preflop_check_facing_bet:${p}:${econ.rawToCallBB}`);
 }else if(code==='CALL'){
  if(econ.rawToCallBB<=EPS)throw new Error(`preflop_call_nothing:${p}`);addContribution(state,x,Math.min(econ.rawToCallBB,x.behindBB));amountTo=x.liveCommitBB;
 }else if(code==='RAISE'||code==='ALLIN'){
  amountTo=code==='ALLIN'?econ.maxRaiseToBB:Number(action.raiseToBB??action.amountToBB);
  if(!Number.isFinite(amountTo))throw new Error('preflop_raise_to_missing');
  amountTo=round(amountTo);if(amountTo<=state.currentBetBB+EPS)throw new Error(`preflop_raise_not_above_current:${amountTo}:${state.currentBetBB}`);if(amountTo>econ.maxRaiseToBB+EPS)throw new Error(`preflop_raise_exceeds_stack:${amountTo}:${econ.maxRaiseToBB}`);
  const oldBet=state.currentBetBB,increment=round(amountTo-oldBet),isAllIn=Math.abs(amountTo-econ.maxRaiseToBB)<=EPS;
  if(amountTo<econ.minFullRaiseToBB-EPS&&!isAllIn)throw new Error(`preflop_raise_below_min:${amountTo}:${econ.minFullRaiseToBB}`);
  addContribution(state,x,amountTo-x.liveCommitBB);state.currentBetBB=amountTo;raiseSize=increment;
  fullRaise=increment>=state.lastFullRaiseSizeBB-EPS;if(fullRaise)state.lastFullRaiseSizeBB=increment;
 }else throw new Error(`preflop_action_invalid:${action.action}`);
 state.actionSeq=Number(state.actionSeq||0)+1;
 state.history.push({id:state.actionSeq,position:p,action:code==='ALLIN'?'ALLIN':code,amountToBB:amountTo,fullRaise,raiseSizeBB:raiseSize,potAfterBB:state.potBB,currentBetAfterBB:state.currentBetBB,behindAfterBB:x.behindBB});
 return state;
}

export function preflopPotConservation(state){
 const committed=round(Object.values(state.players||{}).reduce((s,x)=>s+Number(x.totalCommitBB||0),0)),pot=round(state.potBB);return{valid:Math.abs(committed-pot)<=EPS,committedBB:committed,potBB:pot,diffBB:round(committed-pot)};
}

export function preflopEffectiveStackBB(state,a,b){
 const pa=state?.players?.[normalizePosition(a)],pb=state?.players?.[normalizePosition(b)];if(!pa||!pb)throw new Error('preflop_effective_player_unknown');
 return Math.min(pa.startStackBB,pb.startStackBB);
}
