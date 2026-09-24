import {normalizeTournamentState,readiness} from '../core/tournament-state.js';
import {lookupDistribution} from '../strategy/pack-registry.js';
import {chooseMixed} from '../strategy/mixed.js';

export function decideFromRegisteredPack(raw,{mode='cEV',villainPosition='*',decisionKey=''}={}){
 const state=normalizeTournamentState(raw),gate=readiness(state);
 if(!gate.ready)return{version:'mtt-decision-kernel-v0.2',decision:null,status:'STATE_INCOMPLETE',gate,state};
 const hit=lookupDistribution({game:'NLHE',format:'MTT',mode,tableSize:state.tableSize,effectiveBB:state.bb.effective,node:state.preflop.node,heroPosition:state.heroPosition,villainPosition},state.hand);
 if(!hit?.distribution)return{version:'mtt-decision-kernel-v0.2',decision:null,status:'OUT_OF_COVERAGE',state,pack:hit?.pack??null};
 const seed=decisionKey||[state.hand,state.heroPosition,state.bb.effective.toFixed(3),state.preflop.node,state.bb.pot,state.bb.toCall].join('|');
 const choice=chooseMixed(hit.distribution,state.legalActions,seed);
 if(!choice)return{version:'mtt-decision-kernel-v0.2',decision:null,status:'NO_LEGAL_ACTION_IN_DISTRIBUTION',state,pack:hit.pack,distribution:hit.distribution};
 return{version:'mtt-decision-kernel-v0.2',decision:choice.action,status:'DECISION',state,pack:hit.pack,distribution:choice.masked,seed,depth:{effectiveBB:state.bb.effective,anchorBB:hit.pack.stackDepthBB,policy:hit.pack.depthPolicy||'exact'}};
}
