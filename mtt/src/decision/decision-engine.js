import {normalizeTournamentState,readiness} from '../core/tournament-state.js';
import {lookupDistribution} from '../strategy/pack-registry.js';
import {chooseMixed} from '../strategy/mixed.js';

export function decideFromRegisteredPack(raw,{mode='cEV',villainPosition='*',decisionKey=''}={}){
 const state=normalizeTournamentState(raw),gate=readiness(state);
 if(!gate.ready)return{version:'mtt-decision-kernel-v0.1',decision:null,status:'STATE_INCOMPLETE',gate,state};
 const hit=lookupDistribution({game:'NLHE',format:'MTT',mode,tableSize:state.tableSize,stackBucket:state.stackBucket,node:state.preflop.node,heroPosition:state.heroPosition,villainPosition},state.hand);
 if(!hit?.distribution)return{version:'mtt-decision-kernel-v0.1',decision:null,status:'OUT_OF_COVERAGE',state,pack:hit?.pack??null};
 const seed=decisionKey||[state.hand,state.heroPosition,state.stackBucket,state.preflop.node,state.bb.pot,state.bb.toCall].join('|');
 const choice=chooseMixed(hit.distribution,state.legalActions,seed);
 if(!choice)return{version:'mtt-decision-kernel-v0.1',decision:null,status:'NO_LEGAL_ACTION_IN_DISTRIBUTION',state,pack:hit.pack,distribution:hit.distribution};
 return{version:'mtt-decision-kernel-v0.1',decision:choice.action,status:'DECISION',state,pack:hit.pack,distribution:choice.masked,seed};
}
