import assert from 'node:assert/strict';
import { runStudyRuntime } from '../src/brain/study-runtime.js';

const base=(stack='1.94',history=[],capturedAt=1000)=>({
 version:'vision-v1',heroCards:['As','Kd'],heroPresence:'present',board:[],boardPresence:'absent',
 pot:'0.03',toCall:null,legalActions:['FOLD','RAISE'],players:6,activePlayers:6,heroPosition:'BTN',
 heroStack:'1.00',effectiveStack:'1.00',blinds:'0.01/0.02',confidence:.9,readerModel:'test',capturedAt,
 seats:[{name:'Hero',isHero:true,stack:'1.00',visualSlot:'hero'},{name:'VillainA',stack,visualSlot:'left-high'}],actionHistory:history,
});

// First fresh metadata snapshot anchors stacks; local OCR sees action type.
let r=runStudyRuntime(base('1.94',[],1000),{
 useStudySession:true,metadataObservedAt:1000,
 captureEvents:[{type:'action-candidate',seatId:'left-high',action:'RAISE',at:1400,confidence:.84,source:'local-action-text',raw:'Aumento'}],
});
assert.equal(r.session.captureCandidates.length,1);
assert.equal(r.session.captureCandidates[0].amount,null);
assert.equal(r.finance.stacks.VillainA,1.94);

// New metadata snapshot shows 0.06 spent. The TYPE stays RAISE; only sizing is enriched.
r=runStudyRuntime(base('1.88',[],3500),{session:r.session,useStudySession:true,metadataObservedAt:3500});
assert.equal(r.session.captureCandidates[0].action,'RAISE');
assert.equal(r.session.captureCandidates[0].amount,.06);
assert.equal(r.session.captureCandidates[0].status,'provisional');
assert.equal(r.actionEvidence.sized,1);
assert.equal(r.result.observedLedger.actions[0].amount,.06);
assert.equal(r.result.ledger.actionCount,0);

// Authoritative history promotes to sovereign and observed provisional line disappears.
r=runStudyRuntime(base('1.88',['VillainA raises 0.06'],4200),{session:r.session,useStudySession:true,metadataObservedAt:4200});
assert.equal(r.session.captureCandidates[0].status,'confirmed');
assert.equal(r.result.observedLedger.count,0);
assert.equal(r.result.ledger.actionCount,1);
assert.equal(r.result.ledger.actions[0].action,'RAISE');
assert.equal(r.result.ledger.actions[0].amount,.06);

console.log('study-sizing-v1 regressions: OK');


// Once a financial snapshot was ambiguous, later confirmation/removal of one candidate
// must not allow that old delta to size the remaining action retroactively.
{
  let x=runStudyRuntime(base('1.94',[],10000),{
    useStudySession:true,metadataObservedAt:10000,
    captureEvents:[
      {type:'action-candidate',seatId:'left-high',action:'CALL',at:10400,confidence:.82,source:'local-action-text',raw:'Pago'},
      {type:'action-candidate',seatId:'left-high',action:'RAISE',at:10800,confidence:.84,source:'local-action-text',raw:'Aumento',packetId:'raise-ambiguous'},
    ],
  });
  x=runStudyRuntime(base('1.88',[],12000),{session:x.session,useStudySession:true,metadataObservedAt:12000});
  assert.equal(x.actionEvidence.ambiguousFinancial,1);
  assert.equal(x.session.captureCandidates.every(v=>v.amount==null),true);

  // HH confirms only CALL. The old 0.06 delta must stay blocked instead of
  // getting reassigned to the still-provisional RAISE.
  x=runStudyRuntime(base('1.88',['VillainA calls 0.06'],13000),{session:x.session,useStudySession:true,metadataObservedAt:13000});
  const raise=x.session.captureCandidates.find(v=>v.action==='RAISE');
  assert.equal(raise.status,'provisional');
  assert.equal(raise.amount,null);
  assert.equal(x.session.financialAmbiguous.length,1);
}
