import assert from 'node:assert/strict';
import { buildObservedLedger, observedLedgerSummary } from '../src/brain/observed-ledger.js';

const rows=[
  {handId:7,street:'preflop',seatId:'left-high',actor:'A',action:'RAISE',capturedAt:1000,confidence:.81,source:'local-action-text',status:'provisional',sovereign:false},
  {handId:7,street:'preflop',seatId:'right-high',actor:'B',action:'CALL',capturedAt:1200,confidence:.84,source:'local-action-text',status:'provisional',sovereign:false},
  {handId:7,street:'preflop',seatId:'right-low',actor:null,action:'FOLD',capturedAt:1300,confidence:.96,source:'action-capture-v1.2',status:'provisional',sovereign:false},
  {handId:7,street:'preflop',seatId:'right-low',actor:null,action:'FOLD',capturedAt:1300,confidence:.96,source:'action-capture-v1.2',status:'provisional',sovereign:false},
  {handId:7,street:'preflop',seatId:'top',actor:'C',action:'RAISE',capturedAt:1400,confidence:.4,source:'local-action-text',status:'rejected',sovereign:false},
  {handId:7,street:'preflop',seatId:'left-low',actor:'D',action:'FOLD',capturedAt:1500,confidence:1,source:'action-ledger',status:'confirmed',sovereign:true},
];
const l=buildObservedLedger(rows,{handId:7});
assert.equal(l.version,'observed-ledger-v1');
assert.equal(l.actions.length,3);
assert.deepEqual(l.actions.map(x=>x.action),['RAISE','CALL','FOLD']);
assert.equal(l.actions[2].actor,null);
assert.equal(l.actions.every(x=>x.sovereign===false&&x.status==='provisional'),true);
const s=observedLedgerSummary(l);
assert.equal(s.count,3);
assert.equal(s.actions[0].actor,'A');
console.log('observed-ledger-v1 regressions: OK');
