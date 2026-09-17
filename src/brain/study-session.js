import { createLedger, applyActionHistory, streetFromBoard } from './action-ledger.js';
import { createPlayerProfiles, finalizeHandIntoProfiles } from './player-model.js';
import { captureEventsToCandidates, remapCaptureCandidates, mergeCaptureCandidates, confirmCaptureCandidates } from './action-event-bridge.js';
import { buildObservedLedger } from './observed-ledger.js';
import { createMetadataFinanceState, observeMetadataFinance } from './metadata-finance.js';
import { reconcileActionSizing } from './action-evidence.js';

const heroKey = (state) => Array.isArray(state?.heroCards) && state.heroCards.length === 2 ? state.heroCards.join('') : '';

function heroActorFromSeats(seats = []) {
  const s = Array.isArray(seats) ? seats.find((x) => x && x.isHero) : null;
  return s?.name || s?.player || s?.nick || s?.nickname || null;
}

function deriveSession(sessionInput,{seatMap={}}={}){
  const s={...sessionInput};
  let candidates=remapCaptureCandidates(s.captureCandidates||[],seatMap,s.ledger?.heroActor??null);
  const reconciled=reconcileActionSizing(candidates,s.finance?.deltas||[]);
  candidates=confirmCaptureCandidates(reconciled.candidates,s.ledger);
  return {
    ...s,
    captureCandidates:candidates,
    financialAmbiguous:reconciled.ambiguous,
    observedLedger:buildObservedLedger(candidates,{handId:s.handId??null}),
  };
}

function updateFinance(sessionInput,state={},context={}){
  const s={...sessionInput};
  const marker=Number(context.metadataObservedAt)||null;
  if(marker&&Number(s.lastMetadataObservedAt)&&marker<=Number(s.lastMetadataObservedAt))return s;
  const at=marker || state.capturedAt || Date.now();
  const out=observeMetadataFinance(s.finance||createMetadataFinanceState({street:streetFromBoard(state.board)}),state,at,{forceFresh:Boolean(marker)});
  if(!out.fresh)return s;
  return {...s,finance:out.state,lastMetadataObservedAt:marker||s.lastMetadataObservedAt||null};
}

export function createStudySession() {
  return {
    version:'study-session-v1.3',
    handId:0,
    heroKey:'',
    ledger:null,
    observedLedger:buildObservedLedger([], {handId:0}),
    finance:createMetadataFinanceState(),
    financialAmbiguous:[],
    profiles:createPlayerProfiles(),
    captureCandidates:[],
    completedHands:0,
    lastCapturedAt:null,
    lastMetadataObservedAt:null,
  };
}

export function finalizeCurrentHand(sessionInput) {
  const s={...sessionInput,profiles:sessionInput?.profiles || createPlayerProfiles()};
  if(!s.ledger || !s.ledger.actions?.length) return s;
  s.profiles=finalizeHandIntoProfiles(s.profiles,s.ledger,{handId:s.ledger.handId});
  s.completedHands=(s.completedHands||0)+1;
  return s;
}

export function beginNewHand(sessionInput,state={},explicitHandId=null,context={}) {
  let s=finalizeCurrentHand(sessionInput || createStudySession());
  const next=explicitHandId!=null ? explicitHandId : (Number(s.handId)||0)+1;
  const actor=heroActorFromSeats(state.seats);
  s={
    ...s,
    version:'study-session-v1.3',
    handId:next,
    heroKey:heroKey(state),
    ledger:createLedger({handId:next,heroActor:actor,seats:state.seats||[]}),
    captureCandidates:[],
    finance:createMetadataFinanceState({street:streetFromBoard(state.board)}),
    financialAmbiguous:[],
    lastCapturedAt:state.capturedAt??Date.now(),
  };
  s.ledger.street=streetFromBoard(state.board);
  s.ledger=applyActionHistory(s.ledger,state.actionHistory||[],state.board||[]);
  s.ledger.street=streetFromBoard(state.board);
  s=updateFinance(s,state,context);
  return deriveSession(s,{seatMap:context.seatMap||{}});
}

export function ingestVisionState(sessionInput,state={},context={}) {
  let s=sessionInput || createStudySession();
  if(!s.finance)s={...s,finance:createMetadataFinanceState({street:streetFromBoard(state.board)}),financialAmbiguous:[]};
  const incomingKey=heroKey(state);
  const explicit=context.handId ?? null;
  const needsFirst=!s.ledger && incomingKey;
  const explicitChanged=explicit!=null && s.ledger && explicit!==s.handId;
  const cardsChanged=s.heroKey && incomingKey && s.heroKey!==incomingKey;
  if(needsFirst || explicitChanged || cardsChanged) return beginNewHand(s,state,explicit,context);
  if(!s.ledger) return deriveSession({...s,lastCapturedAt:state.capturedAt??Date.now()},{seatMap:context.seatMap||{}});

  const ledger={...s.ledger,seats:Array.isArray(state.seats)&&state.seats.length?state.seats:s.ledger.seats};
  const actor=heroActorFromSeats(state.seats);
  if(actor) ledger.heroActor=actor;
  s={...s,version:'study-session-v1.3',heroKey:incomingKey||s.heroKey,ledger:applyActionHistory(ledger,state.actionHistory||[],state.board||[]),lastCapturedAt:state.capturedAt??Date.now()};
  s.ledger.street=streetFromBoard(state.board);
  s=updateFinance(s,state,context);
  return deriveSession(s,{seatMap:context.seatMap||{}});
}

export function ingestCaptureEvents(sessionInput,events=[],context={}) {
  const s=sessionInput || createStudySession();
  if(!s.ledger || !Array.isArray(events) || !events.length) return deriveSession(s,{seatMap:context.seatMap||{}});
  const seatMap=context.seatMap || {};
  const existing=remapCaptureCandidates(s.captureCandidates||[],seatMap,s.ledger.heroActor);
  const incoming=captureEventsToCandidates(events,{
    seatMap,
    handId:s.handId,
    street:s.ledger.street || 'preflop',
    heroActor:s.ledger.heroActor,
  });
  const merged=mergeCaptureCandidates(existing,incoming);
  return deriveSession({...s,captureCandidates:merged},{seatMap});
}

export function resetStudySession(sessionInput,{keepProfiles=true}={}) {
  const old=sessionInput || createStudySession();
  const profiles=keepProfiles ? old.profiles : createPlayerProfiles();
  return {...createStudySession(),profiles};
}
