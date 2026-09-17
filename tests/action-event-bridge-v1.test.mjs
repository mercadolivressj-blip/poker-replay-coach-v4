import assert from 'node:assert/strict';
import { createStudySession, ingestVisionState, ingestCaptureEvents } from '../src/brain/study-session.js';
import { captureEventsToCandidates, captureBridgeSummary } from '../src/brain/action-event-bridge.js';

const state = (patch={}) => ({
  version:'vision-v1',
  heroCards:['Ah','Kd'], heroPresence:'present',
  board:[], boardPresence:'absent',
  pot:'0.03', toCall:null, legalActions:['FOLD','RAISE'],
  players:6, activePlayers:6, heroPosition:'BTN', heroStack:'1.00', effectiveStack:'1.00', blinds:'0.01/0.02',
  seats:[{name:'HeroName',isHero:true},{name:'VillainA',isHero:false},{name:'VillainB',isHero:false}],
  actionHistory:[], confidence:.9, readerModel:'test', capturedAt:1000,
  ...patch,
});

let session=ingestVisionState(createStudySession(),state(),{handId:1});
assert.equal(session.ledger.actions.length,0);

const events=[
  {type:'fold-candidate',seatId:'left-high',label:'Seat L2',at:1500,confidence:.96,packetId:'fold-1',cardMode:'back'},
  {type:'seat-change',seatId:'right-high',label:'Seat R2',at:1510,confidence:.5},
  {type:'fold-candidate',seatId:'hero',label:'Hero',at:1520,confidence:.99},
  {type:'action-candidate',seatId:'right-high',label:'Seat R2',action:'CALL',amount:.04,capturedAt:1530,confidence:.81,packetId:'call-1',source:'local-action-text',raw:'Pago US$ 0,04'},
];
session=ingestCaptureEvents(session,events,{seatMap:{'left-high':'VillainA','right-high':'VillainB'}});
assert.equal(session.ledger.actions.length,0,'local visual event must not enter sovereign ledger by itself');
assert.equal(session.captureCandidates.length,2,'fold + parsed action should be provisional evidence');
assert.equal(session.captureCandidates.every(c=>c.status==='provisional'&&c.sovereign===false),true);
assert.equal(session.captureCandidates.find(c=>c.action==='FOLD').actor,'VillainA');
const call=session.captureCandidates.find(c=>c.action==='CALL');
assert.equal(call.actor,'VillainB');
assert.equal(call.amount,.04);
assert.equal(call.evidence.rawText,'Pago US$ 0,04');
assert.deepEqual(captureBridgeSummary(session.captureCandidates),{total:2,provisional:2,confirmed:0,rejected:0});

// Authoritative action history later confirms both actor/action/street pairs.
session=ingestVisionState(session,state({actionHistory:['VillainA: folds','VillainB: calls US$ 0.04'],capturedAt:2000}),{handId:1});
assert.equal(session.ledger.actions.length,2);
assert.equal(session.captureCandidates.every(c=>c.status==='confirmed'&&c.sovereign===true),true);
assert.equal(session.captureCandidates.every(c=>c.confirmedBy==='action-ledger'),true);

// Unknown seat remains useful evidence but cannot become a named sovereign action.
const unknown=captureEventsToCandidates([
  {type:'fold-candidate',seatId:'right-low',label:'Seat R1',at:2500,confidence:.93}
],{handId:1,street:'preflop',seatMap:{},heroActor:'HeroName'});
assert.equal(unknown.length,1);
assert.equal(unknown[0].actor,null);
assert.equal(unknown[0].sovereign,false);

console.log('action-event-bridge-v1 regressions: OK');
