import assert from 'node:assert/strict';
import { createMetadataFinanceState, normalizeSeatFinancialSnapshot, observeMetadataFinance } from '../src/brain/metadata-finance.js';
import { reconcileActionSizing } from '../src/brain/action-evidence.js';

const seats=(a,b)=>[
  {name:'Hero',isHero:true,stack:'1,50'},
  {name:'VillainA',stack:a,visualSlot:'left-high'},
  {name:'VillainB',stack:b,visualSlot:'right-high'},
];

const snap=normalizeSeatFinancialSnapshot(seats('1,94','2.10'));
assert.equal(snap.VillainA.stack,1.94);
assert.equal(snap.VillainA.seatId,'left-high');

let finance=createMetadataFinanceState();
let out=observeMetadataFinance(finance,{board:[],seats:seats('1.94','2.10')},1000);
finance=out.state;
assert.equal(out.deltas.length,0,'first metadata snapshot is baseline only');

out=observeMetadataFinance(finance,{board:[],seats:seats('1.88','2.10')},3500);
finance=out.state;
assert.equal(out.deltas.length,1);
assert.equal(out.deltas[0].actor,'VillainA');
assert.equal(out.deltas[0].amount,.06);
assert.equal(out.deltas[0].fromObservedAt,1000);
assert.equal(out.deltas[0].street,'preflop');

const typeCandidates=[{
  type:'action-candidate',status:'provisional',sovereign:false,source:'local-action-text',
  actor:'VillainA',seatId:'left-high',street:'preflop',action:'RAISE',amount:null,capturedAt:1700,confidence:.82,evidence:{rawText:'Aumento'},
}];
let rec=reconcileActionSizing(typeCandidates,out.deltas);
assert.equal(rec.matched,1);
assert.equal(rec.candidates[0].action,'RAISE','financial evidence must never change OCR action type');
assert.equal(rec.candidates[0].amount,.06);
assert.equal(rec.candidates[0].evidence.financial.stackBefore,1.94);
assert.equal(rec.candidates[0].evidence.financial.stackAfter,1.88);

// Two monetary actions in the same financial interval are ambiguous: never guess which gets the total delta.
const ambiguous=[
  {...typeCandidates[0],action:'CALL',capturedAt:1500},
  {...typeCandidates[0],action:'RAISE',capturedAt:2200},
];
rec=reconcileActionSizing(ambiguous,out.deltas);
assert.equal(rec.matched,0);
assert.equal(rec.ambiguous.length,1);
assert.equal(rec.candidates.every(c=>c.amount==null),true);

// Stack increases are payouts/rebuys/transition, not actions.
out=observeMetadataFinance(finance,{board:[],seats:seats('2.30','2.10')},5000);
assert.equal(out.deltas.length,0);

console.log('metadata-finance-v1 regressions: OK');
