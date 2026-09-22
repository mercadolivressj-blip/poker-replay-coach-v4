import assert from 'node:assert/strict';
import { createStudySession, ingestVisionState, ingestCaptureEvents, finalizeCurrentHand, resetStudySession } from '../src/brain/study-session.js';
import { playerMetrics } from '../src/brain/player-model.js';

const state=(cards,history,patch={})=>({heroCards:cards,board:[],seats:[{name:'Hero',isHero:true},{name:'BTN'}],actionHistory:history,capturedAt:Date.now(),...patch});

let s=createStudySession();
s=ingestVisionState(s,state(['Ah','Kd'],['BTN raises 0.05','Hero calls 0.03']),{handId:1});
assert.equal(s.handId,1); assert.equal(s.ledger.actions.length,2); assert.equal(s.completedHands,0);
assert.equal(s.observedLedger.count,undefined);
assert.equal(s.observedLedger.actions.length,0);
// Same snapshot must not duplicate actions.
s=ingestVisionState(s,state(['Ah','Kd'],['BTN raises 0.05','Hero calls 0.03']),{handId:1});
assert.equal(s.ledger.actions.length,2);
// A fast local read is immediately visible in the observed ledger, never sovereign.
s=ingestCaptureEvents(s,[{type:'action-candidate',seatId:'right-high',action:'CALL',at:1500,confidence:.82,source:'local-action-text',raw:'Pago'}],{seatMap:{'right-high':'BTN'}});
assert.equal(s.ledger.actions.length,2);
assert.equal(s.observedLedger.actions.length,1);
assert.equal(s.observedLedger.actions[0].action,'CALL');
assert.equal(s.observedLedger.actions[0].sovereign,false);
// Authoritative history confirms that same action; it disappears from provisional observed line.
s=ingestVisionState(s,state(['Ah','Kd'],['BTN raises 0.05','Hero calls 0.03','BTN calls 0.02']),{handId:1});
assert.equal(s.ledger.actions.length,3);
assert.equal(s.captureCandidates.find(c=>c.action==='CALL')?.status,'confirmed');
assert.equal(s.observedLedger.actions.length,0);
// New explicit hand finalizes profiles for hand 1.
s=ingestVisionState(s,state(['Qs','Qd'],['Hero raises 0.05','BB calls 0.03'],{seats:[{name:'Hero',isHero:true},{name:'BB'}]}),{handId:2});
assert.equal(s.handId,2); assert.equal(s.completedHands,1);
assert.equal(playerMetrics(s.profiles.players.BTN).hands,1);
assert.equal(playerMetrics(s.profiles.players.Hero).hands,1);
// Finish second hand once.
s=finalizeCurrentHand(s);
assert.equal(s.completedHands,2);
const hero=playerMetrics(s.profiles.players.Hero);
assert.equal(hero.hands,2); assert.equal(hero.vpip,100); assert.equal(hero.pfr,50);
// Finalizing same hand again is profile-idempotent even if completedHands is just a session counter.
const before=s.profiles.players.Hero.hands;
s=finalizeCurrentHand(s);
assert.equal(s.profiles.players.Hero.hands,before);
// Reset keeps profiles by default.
const kept=resetStudySession(s);
assert.equal(kept.profiles.players.Hero.hands,2); assert.equal(kept.ledger,null);
assert.equal(kept.observedLedger.actions.length,0);
console.log('study-session-v1 regressions: OK');
