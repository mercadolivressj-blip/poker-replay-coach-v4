export const STRATEGY_TARGETS=Object.freeze({tableSizes:[6,8,9],stackDepthsBB:[8,10,12,15,20,25,30,40,50,60,75,100],preflopNodes:['unopened','vs_open','vs_open_multiway','vs_3bet','vs_4bet_plus','blind_vs_blind','reshove'],streets:['preflop','flop','turn','river'],modes:['cEV','ICM'],tournamentTypes:['classic','pko','mystery']});

export function coverageFor(state){
 const reasons=[];
 if(![6,8,9].includes(state.tableSize))reasons.push('table_size');
 if(state.tournament.bountyType!=='none')reasons.push('bounty_strategy_pack_not_loaded');
 if(['BUBBLE','ITM','FINAL_TABLE'].includes(state.phase))reasons.push('icm_strategy_pack_not_loaded');
 reasons.push('preflop_postflop_solver_pack_not_loaded');
 return{decisionCertified:false,stateEngineCertified:true,icmMathAvailable:true,reasons};
}
