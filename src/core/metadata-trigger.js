const heroKey = (s) => Array.isArray(s?.heroCards) && s.heroCards.length === 2 ? s.heroCards.join('') : '';
const boardStreet = (s) => {
  const n = Array.isArray(s?.board) ? s.board.length : 0;
  return n >= 5 ? 'river' : n === 4 ? 'turn' : n >= 3 ? 'flop' : 'preflop';
};
const actionsKey = (s) => Array.isArray(s?.legalActions) ? [...s.legalActions].sort().join('|') : '';
const scalar = (v) => v == null ? '' : String(v).trim();

export function createMetadataTriggerState() {
  return {
    version:'metadata-trigger-v1',
    heroKey:'', street:'preflop', pot:'', actions:'', toCall:'',
    lastReadAt:0, lastReadHeroKey:'', lastReadStreet:null,
    pendingReason:null,
  };
}

export function markMetadataRead(triggerInput, visionState = {}, now = Date.now()) {
  const t={...(triggerInput || createMetadataTriggerState())};
  t.lastReadAt=now;
  t.lastReadHeroKey=heroKey(visionState);
  t.lastReadStreet=boardStreet(visionState);
  t.pendingReason=null;
  return t;
}

export function observeMetadataTrigger(triggerInput, visionState = {}, now = Date.now(), { minIntervalMs = 1400 } = {}) {
  const prev=triggerInput || createMetadataTriggerState();
  const next={...prev};
  const hk=heroKey(visionState);
  const street=boardStreet(visionState);
  const pot=scalar(visionState.pot);
  const actions=actionsKey(visionState);
  const toCall=scalar(visionState.toCall);
  const confirmedHand=hk.length===4;

  const firstConfirmedHand=confirmedHand && !prev.heroKey;
  const newHand=confirmedHand && !!prev.heroKey && hk!==prev.heroKey;
  const streetChanged=confirmedHand && street!==prev.street;
  const potChanged=confirmedHand && !!prev.pot && !!pot && pot!==prev.pot;
  const actionsChanged=confirmedHand && !!prev.actions && !!actions && actions!==prev.actions;
  const toCallChanged=confirmedHand && prev.toCall!==toCall && (!!prev.toCall || !!toCall);
  const missingPosition=confirmedHand && !visionState.heroPosition && prev.lastReadHeroKey!==hk;

  let detected=null;
  if(newHand) detected='new-hand';
  else if(firstConfirmedHand) detected='first-hand';
  else if(streetChanged) detected='street-change';
  else if(actionsChanged) detected='hero-actions-change';
  else if(toCallChanged) detected='to-call-change';
  else if(potChanged) detected='pot-change';
  else if(missingPosition) detected='missing-position';

  const reason=detected || prev.pendingReason || null;
  const throttled=Boolean(reason && prev.lastReadAt>0 && now-prev.lastReadAt<minIntervalMs);
  const shouldRead=Boolean(reason && !throttled);

  next.heroKey=hk || prev.heroKey;
  next.street=street;
  next.pot=pot || prev.pot;
  next.actions=actions || prev.actions;
  next.toCall=toCall;
  next.pendingReason=throttled ? reason : (shouldRead ? null : prev.pendingReason);

  return {
    state:next,
    shouldRead,
    reason:shouldRead ? reason : null,
    pendingReason:next.pendingReason,
    throttled,
  };
}
