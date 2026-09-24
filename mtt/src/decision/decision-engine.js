import {normalizeTournamentState,readiness} from '../core/tournament-state.js';
import {lookupDistribution} from '../strategy/pack-registry.js';
import {chooseMixed} from '../strategy/mixed.js';
import {decisionCertificationGate} from '../strategy/certification.js';
import {preflopContextFromState} from '../strategy/pack-context.js';

function inferVillainPosition(state,requested='*'){
 if(requested!=='*')return requested;
 if(state.preflop.lastAggressorPosition)return state.preflop.lastAggressorPosition;
 if(state.preflop.node==='blind_vs_blind'&&state.heroPosition==='SB')return'BB';
 if(state.preflop.node==='blind_vs_blind'&&state.heroPosition==='BB')return'SB';
 return'*';
}

export function decideFromRegisteredPack(raw,{mode='cEV',villainPosition='*',decisionKey='',minimumCertification='solver-verified',allowUnverified=false}={}){
 const state=normalizeTournamentState(raw),gate=readiness(state);
 if(!gate.ready)return{version:'mtt-decision-kernel-v0.6',decision:null,status:'STATE_INCOMPLETE',gate,state};
 const resolvedVillain=inferVillainPosition(state,villainPosition);
 const hit=lookupDistribution({game:'NLHE',format:'MTT',mode,tableSize:state.tableSize,effectiveBB:state.bb.effective,node:state.preflop.node,heroPosition:state.heroPosition,villainPosition:resolvedVillain,preflopContext:preflopContextFromState(state)},state.hand);
 if(!hit?.distribution)return{version:'mtt-decision-kernel-v0.6',decision:null,status:'OUT_OF_COVERAGE',state,pack:hit?.pack??null};
 const certification=decisionCertificationGate(hit.pack,{minimum:minimumCertification,allowUnverified});
 if(!certification.allowed)return{version:'mtt-decision-kernel-v0.6',decision:null,status:'STRATEGY_NOT_CERTIFIED',state,pack:hit.pack,distribution:hit.distribution,certification};
 const seed=decisionKey||[state.hand,state.heroPosition,state.bb.effective.toFixed(3),state.preflop.node,state.bb.pot,state.bb.toCall].join('|');
 const choice=chooseMixed(hit.distribution,state.legalActions,seed);
 if(!choice)return{version:'mtt-decision-kernel-v0.6',decision:null,status:'NO_LEGAL_ACTION_IN_DISTRIBUTION',state,pack:hit.pack,distribution:hit.distribution,certification};
 return{version:'mtt-decision-kernel-v0.6',decision:choice.action,status:'DECISION',state,pack:hit.pack,distribution:choice.masked,seed,certification,depth:{effectiveBB:state.bb.effective,anchorBB:hit.pack.stackDepthBB,policy:hit.pack.depthPolicy||'exact'},context:{policy:hit.pack.contextPolicy||'generic',preflopContext:preflopContextFromState(state),villainPosition:resolvedVillain}};
}
