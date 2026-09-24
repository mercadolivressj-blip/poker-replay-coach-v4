import {normalizeTournamentState,readiness} from '../core/tournament-state.js';
import {coverageFor} from './coverage.js';

export function analyze(raw){
 const state=normalizeTournamentState(raw),gate=readiness(state),coverage=coverageFor(state);
 return{version:'mtt-brain-v0.1-foundation',mode:'OFFLINE_REPLAY_STUDY_ONLY',state,gate,coverage,recommendation:null,status:!gate.ready?'STATE_INCOMPLETE':'CORE_READY_STRATEGY_PACK_PENDING',note:!gate.ready?`Estado incompleto: ${gate.problems.join(', ')}`:'Estado normalizado e pronto. V0.1 não inventa ranges: decisão estratégica só será liberada com pack MTT validado.'};
}
