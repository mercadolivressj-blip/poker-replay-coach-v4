import assert from 'node:assert/strict';
import { createPlayerProfiles, finalizeHandIntoProfiles, playerMetrics, cautiousPlayerLabel } from '../src/brain/player-model.js';

const ledger=(handId,actions)=>({handId,actions});

let store=createPlayerProfiles();
store=finalizeHandIntoProfiles(store,ledger(1,[
  {street:'preflop',actor:'Villain',action:'CALL'},
  {street:'flop',actor:'Villain',action:'CHECK'},
  {street:'turn',actor:'Villain',action:'CALL'},
]));
let m=playerMetrics(store.players.Villain);
assert.equal(m.hands,1);
assert.equal(m.vpip,100);
assert.equal(m.pfr,0);
assert.equal(cautiousPlayerLabel(store.players.Villain).label,'SEM AMOSTRA');

// Same hand is idempotent.
store=finalizeHandIntoProfiles(store,ledger(1,[
  {street:'preflop',actor:'Villain',action:'CALL'},
  {street:'flop',actor:'Villain',action:'BET'},
]));
assert.equal(playerMetrics(store.players.Villain).hands,1);

// Build a meaningful 30-hand sample: 12 VPIP, 4 PFR => loose-passive threshold.
for(let i=2;i<=30;i++){
  const actions=[];
  if(i<=13) actions.push({street:'preflop',actor:'Villain',action:i<=5?'RAISE':'CALL'});
  else actions.push({street:'preflop',actor:'Villain',action:'FOLD'});
  store=finalizeHandIntoProfiles(store,ledger(i,actions));
}
m=playerMetrics(store.players.Villain);
assert.equal(m.hands,30);
assert(m.vpip>=35);
assert(m.pfr<=16);
const label=cautiousPlayerLabel(store.players.Villain);
assert.equal(label.label,'LOOSE-PASSIVO');
assert.equal(label.confidence,'baixa');

// Confidence only improves with a much larger sample.
for(let i=31;i<=100;i++) store=finalizeHandIntoProfiles(store,ledger(i,[{street:'preflop',actor:'Villain',action:'FOLD'}]));
assert.equal(cautiousPlayerLabel(store.players.Villain).confidence,'media');

console.log('player-model-v1 regressions: OK');
