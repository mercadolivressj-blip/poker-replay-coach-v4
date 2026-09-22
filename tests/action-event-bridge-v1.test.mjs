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
  {type:'action-candidate',seatId:'right-high',label:'Seat R2',action:'CALL',amount:1.94,capturedAt:1530,confidence:.81,packetId:'call-1',source:'local-action-text',raw:'Pago US$ 1,94'},
];
session=ingestCaptureEvents(session,events,{seatMap:{'left-high':'VillainA','right-high':'VillainB'}});
assert.equal(session.ledger.actions.length,0,'local visual event must not enter sovereign ledger by itself');
assert.equal(session.captureCandidates.length,2,`unexpected candidates: ${JSON.stringify(session.captureCandidates)}`);
assert.equal(session.captureCandidates.every(c=>c.status==='provisional'&&c.sovereign===false),true,JSON.stringify(session.captureCandidates));
const fold=session.captureCandidates.find(c=>c.action==='FOLD');
assert.ok(fold,`missing FOLD candidate: ${JSON.stringify(session.captureCandidates)}`);
assert.equal(fold.actor,'VillainA');
const call=session.captureCandidates.find(c=>c.action==='CALL');
assert.ok(call,`missing CALL candidate: ${JSON.stringify(session.captureCandidates)}`);
assert.equal(call.actor,'VillainB');
assert.equal(call.amount,null,'OCR amount must never be trusted as action size');
assert.equal(call.evidence.ocrObservedAmount,1.94);
assert.equal(call.evidence.rawText,'Pago US$ 1,94');
assert.deepEqual(captureBridgeSummary(session.captureCandidates),{total:2,provisional:2,confirmed:0,rejected:0});

session=ingestVisionState(session,state({actionHistory:['VillainA: folds','VillainB: calls US$ 0.04'],capturedAt:2000}),{handId:1});
assert.equal(session.ledger.actions.length,2);
assert.equal(session.captureCandidates.every(c=>c.status==='confirmed'&&c.sovereign===true),true);
assert.equal(session.captureCandidates.every(c=>c.confirmedBy==='action-ledger'),true);

const unknown=captureEventsToCandidates([
  {type:'fold-candidate',seatId:'right-low',label:'Seat R1',at:2500,confidence:.93}
],{handId:1,street:'preflop',seatMap:{},heroActor:'HeroName'});
assert.equal(unknown.length,1);
assert.equal(unknown[0].actor,null);
assert.equal(unknown[0].sovereign,false);

console.log('action-event-bridge-v1 regressions: OK');


// One sovereign action may confirm at most one provisional candidate.
// This protects replay streams that flash the same action more than once.
{
  const state2=state({actionHistory:['VillainB: calls US$ 0.04'],capturedAt:3000});
  let s=ingestVisionState(createStudySession(),state(),{handId:2});
  s=ingestCaptureEvents(s,[
    {type:'action-candidate',seatId:'right-high',action:'CALL',capturedAt:2600,confidence:.9,source:'local-action-inference'},
    {type:'action-candidate',seatId:'right-high',action:'CALL',capturedAt:2700,confidence:.88,source:'local-action-inference',packetId:'dup-call'},
  ],{seatMap:{'right-high':'VillainB'}});
  s=ingestVisionState(s,state2,{handId:2});
  assert.equal(s.captureCandidates.filter(x=>x.status==='confirmed').length,1);
  assert.equal(s.captureCandidates.filter(x=>x.status==='provisional').length,1);
}

// If both sides have an amount, a mismatched size must not be promoted.
{
  let s=ingestVisionState(createStudySession(),state(),{handId:3});
  s=ingestCaptureEvents(s,[
    {type:'action-candidate',seatId:'right-high',action:'CALL',amount:.02,capturedAt:3600,confidence:.9,source:'local-commitment'},
  ],{seatMap:{'right-high':'VillainB'}});
  s=ingestVisionState(s,state({actionHistory:['VillainB: calls US$ 0.04'],capturedAt:4000}),{handId:3});
  assert.equal(s.captureCandidates[0].status,'provisional');
}
