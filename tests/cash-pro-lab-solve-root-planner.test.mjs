import assert from 'node:assert/strict';
import test from 'node:test';
import { iterateStrategicCurriculum } from '../src/cash-pro-lab/strategic-curriculum.js';
import { parseOrderedMatchup, supported100zSrpPaths, solveRootCandidatesForStrategicTicket, planReusableSolveRoots, estimateRootDecisionCoverage } from '../src/cash-pro-lab/solve-root-planner.js';

test('ordered matchup parser preserves hero perspective but solver path identifies actual opener',()=>{
  assert.deepEqual(parseOrderedMatchup('BB-vs-BTN'),{heroPosition:'BB',villainPosition:'BTN',positions:['BB','BTN']});
  const paths=supported100zSrpPaths('BB-vs-BTN');
  assert.ok(paths.some(x=>x.openerPosition==='BTN'&&x.defenderPosition==='BB'));
  assert.equal(paths.some(x=>x.openerPosition==='BB'),false);
});

test('flop turn and river tickets for the same 100bb SRP sample collapse to the same solve root',()=>{
  const base={
    lane:'postflop-heads-up',sampleIndex:2,sampleSeed:123,split:'train',
    axes:{effectiveStackBB:100,positionMatchup:'BB-vs-BTN',potType:'srp',initiative:'villain',facingClass:'bet-large',textureClass:'two-tone'},
  };
  const keys=[];
  for(const street of ['flop','turn','river']){
    const out=solveRootCandidatesForStrategicTicket({...base,axes:{...base.axes,street}});
    assert.equal(out.ok,true);
    assert.equal(out.roots.length,1);
    keys.push(out.roots[0].key);
    assert.equal(estimateRootDecisionCoverage(out.roots[0]),45);
  }
  assert.equal(new Set(keys).size,1);
});

test('non-100bb and non-SRP tickets are rejected from the frozen 100z SRP teacher instead of approximated',()=>{
  const base={lane:'postflop-heads-up',sampleIndex:0,sampleSeed:1,split:'train',axes:{street:'flop',positionMatchup:'BB-vs-BTN',initiative:'villain',facingClass:'check',textureClass:'dry'}};
  const fifty=solveRootCandidatesForStrategicTicket({...base,axes:{...base.axes,effectiveStackBB:50,potType:'srp'}});
  assert.equal(fifty.ok,false);
  assert.ok(fifty.errors.includes('starting_stack_not_100bb'));
  const threeBet=solveRootCandidatesForStrategicTicket({...base,axes:{...base.axes,effectiveStackBB:100,potType:'3bp'}});
  assert.equal(threeBet.ok,false);
  assert.ok(threeBet.errors.includes('pot_type_not_srp'));
});

test('entire HU curriculum is compressed into reusable exact-domain solve roots',()=>{
  const tickets=iterateStrategicCurriculum({lanes:['postflop-heads-up']});
  const plan=planReusableSolveRoots(tickets);
  assert.equal(plan.ticketsSeen,1382400);
  assert.ok(plan.eligibleTickets>0);
  assert.ok(plan.uniqueSolveRoots>0);
  assert.ok(plan.uniqueSolveRoots<plan.eligibleTickets/10);
  assert.ok(plan.compressionRatio>10);
  assert.ok((plan.rejectionCounts.starting_stack_not_100bb||0)>0);
  assert.ok((plan.rejectionCounts.pot_type_not_srp||0)>0);
  assert.equal(plan.roots.some(r=>r.startingStackBB!==100),false);
  assert.equal(plan.roots.some(r=>r.potType!=='srp'),false);
});
