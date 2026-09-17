import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runStudyRuntime } from '../src/brain/study-runtime.js';

const fixture=JSON.parse(fs.readFileSync(fileURLToPath(new URL('./fixtures/replay-diagnostic-2026-09-16.fixture.json',import.meta.url)),'utf8'));
assert.equal(fixture.source,'replay-diagnostic-2026-09-16T00-23-01-622Z.json');
assert.equal(fixture.frames.length,5);
assert.equal(fixture.fastTileSamples[0].tiles[0].action,'FOLD');
assert.equal(fixture.fastTileSamples[2].tiles[0].amount,'0,02');

const state=(f)=>({
  version:'vision-v1',
  heroCards:f.heroCards,heroPresence:f.heroCards?.length===2?'present':null,
  board:f.board,boardPresence:f.board?.length?'present':'absent',
  pot:f.pot,toCall:f.toCall,legalActions:f.legalActions,
  players:f.seats?.length||null,activePlayers:f.seats?.filter(s=>s.isActive!==false).length||null,
  heroPosition:f.heroPosition,heroStack:null,effectiveStack:null,blinds:f.blinds,
  seats:f.seats,actionHistory:f.actionHistory,confidence:f.confidence,readerModel:'real-replay-fixture',
  capturedAt:f.capturedAt,
});

const [pre,flop,flopAction,river,nextHand]=fixture.frames;
let r=runStudyRuntime(state(pre),{useStudySession:true,handId:pre.sourceHandId});
assert.equal(r.session.handId,1);
assert.equal(r.seatIdentity.map.hero,'wruckzinho');
assert.ok(r.seatIdentity.unresolvedActors.includes('NicholasCason7'),'real fixture must not invent visual seat mapping');
assert.deepEqual(r.result.ledger.actions.map(a=>[a.actor,a.action,a.amount]),[
  ['geefreitas','FOLD',null],['LovID','RAISE',.08],['Brayner5','CALL',.08],['kirro24','CALL',.08],
]);

r=runStudyRuntime(state(flop),{session:r.session,useStudySession:true,handId:flop.sourceHandId});
assert.equal(r.result.ledger.street,'flop');
assert.deepEqual(r.result.ledger.byStreet.flop.map(a=>[a.actor,a.action]),[
  ['LovID','CHECK'],['Brayner5','CHECK'],['kirro24','CHECK'],
],'case drift LoviD/LovID must resolve to one stable actor');

r=runStudyRuntime(state(flopAction),{session:r.session,useStudySession:true,handId:flopAction.sourceHandId});
assert.deepEqual(r.result.ledger.byStreet.flop.slice(-3).map(a=>[a.actor,a.action,a.amount]),[
  ['LovID','BET',.02],['Brayner5','CALL',.02],['wruckzinho','CALL',.02],
]);

r=runStudyRuntime(state(river),{session:r.session,useStudySession:true,handId:river.sourceHandId});
assert.equal(r.result.ledger.street,'river');

r=runStudyRuntime(state(nextHand),{session:r.session,useStudySession:true,handId:nextHand.sourceHandId});
assert.equal(r.session.handId,2);
assert.equal(r.session.completedHands,1);
assert.ok(r.session.profiles.players.LovID);
assert.equal(r.session.profiles.players.LoviD,undefined,'same player must not split profile only because reader changed letter casing');
assert.equal(r.session.profiles.players.LovID.hands,1);
assert.equal(r.session.ledger.actions[0].actor,'kirro24');
assert.equal(r.session.ledger.actions[1].actor,'wruckzinho');

console.log('real-replay-runtime-v1 regressions: OK');