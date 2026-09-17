import assert from 'node:assert/strict';
import { createStudySession, ingestVisionState, finalizeCurrentHand, resetStudySession } from '../src/brain/study-session.js';
import { playerMetrics } from '../src/brain/player-model.js';

const state=(cards,history,patch={})=>({heroCards:cards,board:[],seats:[{name:'Hero',isHero:true}],actionHistory:history,capturedAt:Date.now(),...patch});

let s=createStudySession();
s=ingestVisionState(s,state(['Ah','Kd'],['BTN raises 0.05','Hero calls 0.03']),{handId:1});
assert.equal(s.handId,1); assert.equal(s.ledger.actions.length,2); assert.equal(s.completedHands,0);
// Same snapshot must not duplicate actions.
s=ingestVisionState(s,state(['Ah','Kd'],['BTN raises 0.05','Hero calls 0.03']),{handId:1});
assert.equal(s.ledger.actions.length,2);
// New explicit hand finalizes profiles for hand 1.
s=ingestVisionState(s,state(['Qs','Qd'],['Hero raises 0.05','BB calls 0.03']),{handId:2});
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
console.log('study-session-v1 regressions: OK');
