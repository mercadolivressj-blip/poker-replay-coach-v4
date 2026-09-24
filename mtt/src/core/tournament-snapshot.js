import {normalizeTournamentContext,contextReadiness,strategyRoutingKey} from './tournament-context.js';
import {normalizeTournamentState,readiness as stateReadiness} from './tournament-state.js';
import {normalizeTableState,effectiveStacksByOpponent} from './table-state.js';
import {normalizeBlindLevel,blindPressure} from './blind-pressure.js';

export function buildTournamentSnapshot(raw={}){
 const context=normalizeTournamentContext(raw);
 const contextGate=contextReadiness(context);
 const state=normalizeTournamentState(raw);
 const stateGate=stateReadiness(state);
 const level=normalizeBlindLevel({
  smallBlind:context.structure.current.smallBlind,
  bigBlind:context.structure.current.bigBlind,
  ante:context.structure.current.ante,
  anteType:context.structure.current.anteType,
  nextSmallBlind:context.structure.next.smallBlind,
  nextBigBlind:context.structure.next.bigBlind,
  nextAnte:context.structure.next.ante,
  secondsToNextLevel:context.structure.secondsToNextLevel,
  level:context.structure.level
 });
 const pressure=blindPressure({...level,heroStack:state.chips.heroStack});
 let table=null,effectiveByOpponent=[];
 if(Array.isArray(raw.seats)&&raw.seats.length){
  table=normalizeTableState({bigBlind:state.blinds.big,nextBigBlind:level.next.bigBlind,seats:raw.seats});
  effectiveByOpponent=effectiveStacksByOpponent(table);
 }
 const problems=[...contextGate.problems,...stateGate.problems];
 if(table&&table.hero==null)problems.push('hero_seat_missing_from_table_state');
 return{
  version:'mtt-tournament-snapshot-v0.2',
  ready:problems.length===0,
  problems,
  routingKey:strategyRoutingKey(context),
  context,state,level,blindPressure:pressure,table,effectiveByOpponent,
  decisionModeRequirement: decisionModeRequirement(state,raw)
 };
}

export function decisionModeRequirement(state,raw={}){
 const payouts=Array.isArray(raw.payouts)?raw.payouts.filter(x=>Number(x)>=0):[];
 const tableStacks=Array.isArray(raw.seats)?raw.seats.filter(s=>s?.occupied!==false&&Number(s?.stack)>0).map(s=>Number(s.stack)):[];
 const late=['BUBBLE','ITM','FINAL_TABLE'].includes(state.phase);
 const icmInputsReady=payouts.length>0&&tableStacks.length>1;
 if(late)return{preferred:'ICM',requiredForCertification:true,inputsReady:icmInputsReady,reason:'late_tournament_phase'};
 return{preferred:'cEV',requiredForCertification:false,inputsReady:icmInputsReady,reason:'non_late_phase'};
}
