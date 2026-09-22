import assert from 'node:assert/strict';
import { parseActionLine, createLedger, applyActionHistory } from '../src/brain/action-ledger.js';

// Real PokerStars-style strings preserved from the 2026-09-16 replay diagnostic.
let a=parseActionLine('LovID desiste');
assert.equal(a.actor,'LovID'); assert.equal(a.action,'FOLD'); assert.equal(a.amount,null);
a=parseActionLine('Diógene$ desiste');
assert.equal(a.actor,'Diógene$'); assert.equal(a.action,'FOLD');
a=parseActionLine('geefreitas desiste');
assert.equal(a.actor,'geefreitas'); assert.equal(a.action,'FOLD');

// Forced blinds are context, not voluntary aggression/actions for the strategy ledger.
assert.equal(parseActionLine('Diógene$ postou SB US$ 0,01'),null);
assert.equal(parseActionLine('geefreitas postou BB US$ 0,02'),null);

// Numeric characters in a nickname must NEVER become action sizing.
a=parseActionLine('NicholasCason7 paga US$ 0,02');
assert.equal(a.actor,'NicholasCason7'); assert.equal(a.action,'CALL'); assert.equal(a.amount,.02);
a=parseActionLine('Player2: calls $0.04');
assert.equal(a.actor,'Player2'); assert.equal(a.action,'CALL'); assert.equal(a.amount,.04);

// Portuguese raise-to wording should expose the final target amount.
a=parseActionLine('Jpzziinn aumenta para US$ 0,06');
assert.equal(a.actor,'Jpzziinn'); assert.equal(a.action,'RAISE'); assert.equal(a.amount,.06); assert.equal(a.toAmount,.06);

// Actor-less generic full-reader lines are not allowed to fabricate an actor.
assert.equal(parseActionLine('CHECK'),null);
assert.equal(parseActionLine('CALL 0,02'),null);

// Street markers preserve chronological line assignment.
let l=createLedger({handId:2,heroActor:'wruckzinho'});
l=applyActionHistory(l,[
  'LovID desiste','Diógene$ desiste','geefreitas desiste','*** FLOP ***','NicholasCason7 checks','wruckzinho aposta US$ 0,02'
],['Js','Kc','Ks']);
assert.deepEqual(l.actions.map(x=>[x.street,x.actor,x.action,x.amount]),[
  ['preflop','LovID','FOLD',null],
  ['preflop','Diógene$','FOLD',null],
  ['preflop','geefreitas','FOLD',null],
  ['flop','NicholasCason7','CHECK',null],
  ['flop','wruckzinho','BET',.02],
]);

console.log('real-replay-action-parser-v1 regressions: OK');
