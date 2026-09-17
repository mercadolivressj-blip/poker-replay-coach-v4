import assert from 'node:assert/strict';
import {createActionInferenceState,seedCommitments,inferCommitmentAction,resetActionInferenceStreet,inferStackDeltaAction} from '../src/brain/action-inference.js';

let s=seedCommitments(createActionInferenceState({street:'preflop'}),{SB:.01,BB:.02,CO:0});
let r=inferCommitmentAction(s,{actor:'CO',totalCommitted:.06,confidence:.9,at:1000});
assert.equal(r.event.action,'RAISE');
assert.equal(r.event.amount,.06);s=r.state;

r=inferCommitmentAction(s,{actor:'SB',totalCommitted:.06,confidence:.92,at:1100});
assert.equal(r.event.action,'CALL');
assert.equal(r.event.amount,.05);s=r.state;

r=inferCommitmentAction(s,{actor:'BB',totalCommitted:.18,confidence:.93,at:1200});
assert.equal(r.event.action,'RAISE');
assert.equal(r.event.maxCommittedBefore,.06);s=r.state;

r=inferCommitmentAction(s,{actor:'CO',totalCommitted:.18,confidence:.9,at:1300});
assert.equal(r.event.action,'CALL');
s=r.state;

s=resetActionInferenceStreet(s,'flop');
r=inferCommitmentAction(s,{actor:'CO',totalCommitted:.04,confidence:.95,at:2000});
assert.equal(r.event.action,'BET');s=r.state;

r=inferCommitmentAction(s,{actor:'BB',totalCommitted:.04,confidence:.94,at:2100});
assert.equal(r.event.action,'CALL');s=r.state;

r=inferStackDeltaAction(s,{actor:'CO',stackBefore:1.00,stackAfter:.92,confidence:.7,at:2200});
assert.equal(r.event.action,'RAISE');
assert.equal(r.event.amount,.08);

const bad=inferCommitmentAction(r.state,{actor:'CO',totalCommitted:.01,at:2300});
assert.equal(bad.event,null);
assert.equal(bad.reason,'commitment-decreased-without-street-reset');

console.log('action-inference-v1 regressions: OK');
