import { createStudySession, ingestVisionState, ingestCaptureEvents } from './study-session.js';
import { resolveSeatIdentity } from './seat-identity.js';
import { decideBrain } from './decision.js';
import { metadataFinanceSummary } from './metadata-finance.js';
import { actionEvidenceSummary } from './action-evidence.js';

export function runStudyRuntime(state, context={}){
  const seatIdentity=resolveSeatIdentity(state?.seats||[],{
    heroActor:context.heroActor??null,
    localStacks:context.captureLocalStacks&&typeof context.captureLocalStacks==='object'?context.captureLocalStacks:{},
    orderedFromHero:context.seatsOrderedFromHero===true,
    orientation:context.seatOrientation==='right'?'right':'left',
  });
  const provided=context.captureSeatMap&&typeof context.captureSeatMap==='object'?context.captureSeatMap:{};
  const captureSeatMap=Object.keys(provided).length?provided:seatIdentity.map;
  const base=context.session&&typeof context.session==='object'?context.session:createStudySession();
  let session=ingestVisionState(base,state,{handId:context.handId??null,seatMap:captureSeatMap});
  if(Array.isArray(context.captureEvents)&&context.captureEvents.length){
    session=ingestCaptureEvents(session,context.captureEvents,{seatMap:captureSeatMap});
  }
  const decisionContext={...context};
  for(const k of ['session','useStudySession','captureEvents','captureSeatMap','captureLocalStacks','seatsOrderedFromHero','seatOrientation','handHistoryText','manualActionHistory']) delete decisionContext[k];
  Object.assign(decisionContext,{
    handId:session.handId||context.handId||null,
    heroActor:session.ledger?.heroActor??context.heroActor??null,
    profiles:session.profiles,
    ledger:session.ledger,
    observedLedger:session.observedLedger,
    captureCandidates:session.captureCandidates||[],
  });
  const result=decideBrain(state,decisionContext);
  return {
    version:'study-runtime-v1.1',
    seatIdentity,
    captureSeatMap,
    finance:metadataFinanceSummary(session.finance),
    actionEvidence:actionEvidenceSummary(session.captureCandidates||[],session.financialAmbiguous||[]),
    session,
    result,
  };
}
