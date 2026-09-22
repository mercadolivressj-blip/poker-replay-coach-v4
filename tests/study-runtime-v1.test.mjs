import assert from 'node:assert/strict';
import { runStudyRuntime } from '../src/brain/study-runtime.js';

const vision={
 version:'vision-v1',heroCards:['As','Kd'],heroPresence:'present',board:[],boardPresence:'absent',
 pot:'0.03',toCall:null,legalActions:['FOLD','RAISE'],players:6,activePlayers:6,heroPosition:'BTN',
 heroStack:'1.00',effectiveStack:'1.00',blinds:'0.01/0.02',confidence:.9,readerModel:'test',capturedAt:1000,
 seats:[{name:'Hero',isHero:true},{name:'VillainA',visualSlot:'left-high'}],actionHistory:[]
};
const r1=runStudyRuntime(vision,{useStudySession:true,captureEvents:[{type:'fold-candidate',seatId:'left-high',at:1100,confidence:.95}]});
assert.equal(r1.version,'study-runtime-v1');
assert.equal(r1.seatIdentity.map['left-high'],'VillainA');
assert.equal(r1.session.observedLedger.actions.length,1);
assert.equal(r1.session.ledger.actions.length,0);
assert.equal(r1.result.observedLedger.count,1);

const vision2={...vision,actionHistory:['VillainA folds'],capturedAt:1200};
const r2=runStudyRuntime(vision2,{session:r1.session,useStudySession:true});
assert.equal(r2.session.ledger.actions.length,1);
assert.equal(r2.session.captureCandidates[0].status,'confirmed');
assert.equal(r2.session.observedLedger.actions.length,0);
assert.equal(r2.result.ledger.actionCount,1);
assert.equal(r2.result.ledger.byStreet.preflop[0].actor,'VillainA');
console.log('study-runtime-v1 regressions: OK');
