import { validatePokerSnapshot } from '../core/snapshot-validator.js';
import { runStudyRuntime } from './study-runtime.js';

const amount = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const cleaned=v.replace(/[^0-9,.-]/g,'');
  if(!cleaned) return null;
  const n = Number(cleaned.replace(',','.'));
  return Number.isFinite(n) ? n : null;
};

export function snapshotFromVisionState(state={}, context={}) {
  const physicalButtons=context.buttonsSource==='physical-action-buttons' && Array.isArray(context.heroButtons)
    ? context.heroButtons : [];
  return {
    heroCards: Array.isArray(state.heroCards) ? state.heroCards : [],
    heroPresence: state.heroPresence ?? context.heroPresence ?? null,
    board: Array.isArray(state.board) ? state.board : [],
    heroButtons: physicalButtons,
    heroTurnConfirmed: context.heroTurnConfirmed === true,
    buttonsSource: context.buttonsSource ?? null,
    heroPosition: state.heroPosition ?? context.heroPosition ?? null,
    positionSource: context.positionSource ?? null,
    pot: amount(state.pot),
    toCall: amount(context.toCall ?? state.toCall),
    toCallSource: context.toCallSource ?? null,
    heroStack: amount(state.heroStack),
    actionComplete: context.actionComplete === true,
    actionHistory: Array.isArray(state.actionHistory) ? state.actionHistory : [],
  };
}

/** Fixed-layout entry point: invalid snapshots never reach the strategy runner. */
export function runValidatedStudyRuntime(state, context={}, runner=runStudyRuntime) {
  const snapshot=snapshotFromVisionState(state,context);
  const validation=validatePokerSnapshot(snapshot);
  if(!validation.ok) return {version:'validated-study-runtime-v1',blocked:true,validation,snapshot,result:null};
  const out=runner(state,context);
  return {...out,version:'validated-study-runtime-v1',blocked:false,validation,snapshot};
}
