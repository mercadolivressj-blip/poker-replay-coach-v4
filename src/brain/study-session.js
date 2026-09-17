import { createLedger, applyActionHistory, streetFromBoard } from './action-ledger.js';
import { createPlayerProfiles, finalizeHandIntoProfiles } from './player-model.js';

const heroKey = (state) => Array.isArray(state?.heroCards) && state.heroCards.length === 2 ? state.heroCards.join('') : '';

function heroActorFromSeats(seats = []) {
  const s = Array.isArray(seats) ? seats.find((x) => x && x.isHero) : null;
  return s?.name || s?.player || s?.nick || s?.nickname || null;
}

export function createStudySession() {
  return {
    version:'study-session-v1',
    handId:0,
    heroKey:'',
    ledger:null,
    profiles:createPlayerProfiles(),
    completedHands:0,
    lastCapturedAt:null,
  };
}

export function finalizeCurrentHand(sessionInput) {
  const s={...sessionInput,profiles:sessionInput?.profiles || createPlayerProfiles()};
  if(!s.ledger || !s.ledger.actions?.length) return s;
  s.profiles=finalizeHandIntoProfiles(s.profiles,s.ledger,{handId:s.ledger.handId});
  s.completedHands=(s.completedHands||0)+1;
  return s;
}

export function beginNewHand(sessionInput,state={},explicitHandId=null) {
  let s=finalizeCurrentHand(sessionInput || createStudySession());
  const next=explicitHandId!=null ? explicitHandId : (Number(s.handId)||0)+1;
  const actor=heroActorFromSeats(state.seats);
  s={...s,handId:next,heroKey:heroKey(state),ledger:createLedger({handId:next,heroActor:actor,seats:state.seats||[]}),lastCapturedAt:state.capturedAt??Date.now()};
  s.ledger.street=streetFromBoard(state.board);
  s.ledger=applyActionHistory(s.ledger,state.actionHistory||[],state.board||[]);
  s.ledger.street=streetFromBoard(state.board);
  return s;
}

export function ingestVisionState(sessionInput,state={},context={}) {
  let s=sessionInput || createStudySession();
  const incomingKey=heroKey(state);
  const explicit=context.handId ?? null;
  const needsFirst=!s.ledger && incomingKey;
  const explicitChanged=explicit!=null && s.ledger && explicit!==s.handId;
  const cardsChanged=s.heroKey && incomingKey && s.heroKey!==incomingKey;
  if(needsFirst || explicitChanged || cardsChanged) s=beginNewHand(s,state,explicit);
  else if(!s.ledger) return {...s,lastCapturedAt:state.capturedAt??Date.now()};
  else {
    const ledger={...s.ledger,seats:Array.isArray(state.seats)&&state.seats.length?state.seats:s.ledger.seats};
    const actor=heroActorFromSeats(state.seats);
    if(actor) ledger.heroActor=actor;
    s={...s,heroKey:incomingKey||s.heroKey,ledger:applyActionHistory(ledger,state.actionHistory||[],state.board||[]),lastCapturedAt:state.capturedAt??Date.now()};
    s.ledger.street=streetFromBoard(state.board);
  }
  return s;
}

export function resetStudySession(sessionInput,{keepProfiles=true}={}) {
  const old=sessionInput || createStudySession();
  const profiles=keepProfiles ? old.profiles : createPlayerProfiles();
  return {...createStudySession(),profiles};
}
