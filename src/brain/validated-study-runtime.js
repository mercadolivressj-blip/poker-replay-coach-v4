import { validatePokerSnapshot } from '../core/snapshot-validator.js';
import { runStudyRuntime } from './study-runtime.js';

const amount = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/[^0-9,.-]/g,'').replace(',','.'));
  return Number.isFinite(n) ? n : null;
};

export function snapshotFromVisionState(state={}, context={}) {
  return {
    heroCards: Array.isArray(state.heroCards) ? state.heroCards : [],
    board: Array.isArray(state.board) ? state.board : [],
    heroButtons: Array.isArray(context.heroButtons) ? context.heroButtons : (Array.isArray(state.legalActions) ? state.legalActions : []),
    heroPosition: state.heroPosition ?? context.heroPosition ?? null,
    positionSource: context.positionSource ?? null,
    pot: amount(state.pot),
    toCall: amount(state.toCall),
    heroStack: amount(state.heroStack),
    actionComplete: context.actionComplete === true,
    actionHistory: Array.isArray(state.actionHistory) ? state.actionHistory : [],
  };
}

/** Fixed-layout entry point: invalid snapshots never reach decideBrain. */
export function runValidatedStudyRuntime(state, context={}, runner=runStudyRuntime) {
  const snapshot=snapshotFromVisionState(state,context);
  const validation=validatePokerSnapshot(snapshot);
  if(!validation.ok) return {version:'validated-study-runtime-v1',blocked:true,validation,snapshot,result:null};
  const out=runner(state,context);
  return {...out,version:'validated-study-runtime-v1',blocked:false,validation,snapshot};
}
