import assert from 'node:assert/strict';
import {createActionSeatState,observeSeatCardState,applyActionSeatEvents,actionSeatEligibility,actionSeatStateSummary} from '../src/core/action-seat-state.js';
import {shouldAcceptOcrAction} from '../src/core/action-ocr-gate.js';

let s=createActionSeatState([{id:'left-high'},{id:'right-low'}]);
assert.equal(actionSeatEligibility(s,'left-high').eligible,false);

s=observeSeatCardState(s,{seats:{'left-high':{cardPresent:true},'right-low':{cardPresent:false}}},1000);
assert.equal(actionSeatEligibility(s,'left-high').eligible,true);
assert.equal(actionSeatEligibility(s,'right-low').eligible,false);

// A temporary bad card read must not deactivate a player already seen with cards.
s=observeSeatCardState(s,{seats:{'left-high':{cardPresent:false}}},1100);
assert.equal(actionSeatEligibility(s,'left-high').eligible,true);
assert.equal(shouldAcceptOcrAction({action:'CALL',confidence:.8,activeThisHand:true,folded:false,raw:'Pago'}).ok,true);

s=applyActionSeatEvents(s,[{type:'fold-candidate',seatId:'left-high',at:1200}],1200);
assert.equal(actionSeatEligibility(s,'left-high').eligible,false);
assert.equal(shouldAcceptOcrAction({action:'CALL',confidence:.8,activeThisHand:true,folded:true,raw:'Pago'}).ok,false);
assert.deepEqual(actionSeatStateSummary(s).folded,['left-high']);

s=applyActionSeatEvents(s,[{type:'table-transition',seatId:'table',at:2000}],2000);
assert.equal(actionSeatEligibility(s,'left-high').eligible,false);
assert.equal(s.handSeq,1);

console.log('action-seat-state-v1 regressions: OK');
