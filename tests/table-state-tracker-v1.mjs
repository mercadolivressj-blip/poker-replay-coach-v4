import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assignPositions, inferEvents, TableStateTracker } from '../src/core/table-state-tracker.js';

const seats = [
  { seatIndex: 0, actorName: 'A', stack: 1000, committed: 0, dealer: false, folded: false, hero: false, visibleAction: null, visibleActionAmount: null, confidence: .95 },
  { seatIndex: 1, actorName: 'B', stack: 1000, committed: 0, dealer: true, folded: false, hero: false, visibleAction: null, visibleActionAmount: null, confidence: .95 },
  { seatIndex: 2, actorName: 'Hero', stack: 1000, committed: 0, dealer: false, folded: false, hero: true, visibleAction: null, visibleActionAmount: null, confidence: .95 },
  { seatIndex: 3, actorName: 'D', stack: 1000, committed: 0, dealer: false, folded: false, hero: false, visibleAction: null, visibleActionAmount: null, confidence: .95 },
  { seatIndex: 4, actorName: 'E', stack: 1000, committed: 0, dealer: false, folded: false, hero: false, visibleAction: null, visibleActionAmount: null, confidence: .95 },
  { seatIndex: 5, actorName: 'F', stack: 1000, committed: 0, dealer: false, folded: false, hero: false, visibleAction: null, visibleActionAmount: null, confidence: .95 },
];
const positioned = assignPositions(seats);
assert.equal(positioned.find((s) => s.actorName === 'B').position, 'BTN');
assert.equal(positioned.find((s) => s.actorName === 'Hero').position, 'SB');
assert.equal(positioned.find((s) => s.actorName === 'D').position, 'BB');
assert.equal(positioned.find((s) => s.actorName === 'A').position, 'CO');

const prev = { handId: 8, street: 'flop', seats: assignPositions(seats) };
const nextBetSeats = seats.map((s) => s.actorName === 'A' ? { ...s, stack: 700, committed: 300 } : s);
const betEvents = inferEvents(prev, { handId: 8, street: 'flop', seats: assignPositions(nextBetSeats) });
assert.equal(betEvents.length, 1);
assert.equal(betEvents[0].actorName, 'A');
assert.equal(betEvents[0].action, 'bet');
assert.equal(betEvents[0].amount, 300);

const callPrevSeats = nextBetSeats;
const callNextSeats = nextBetSeats.map((s) => s.actorName === 'Hero' ? { ...s, stack: 700, committed: 300 } : s);
const callEvents = inferEvents(
  { handId: 8, street: 'flop', seats: assignPositions(callPrevSeats) },
  { handId: 8, street: 'flop', seats: assignPositions(callNextSeats) },
);
assert.equal(callEvents.length, 1);
assert.equal(callEvents[0].action, 'call');

const raiseNext = callNextSeats.map((s) => s.actorName === 'D' ? { ...s, stack: 400, committed: 600 } : s);
const raiseEvents = inferEvents(
  { handId: 8, street: 'flop', seats: assignPositions(callNextSeats) },
  { handId: 8, street: 'flop', seats: assignPositions(raiseNext) },
);
assert.equal(raiseEvents.length, 1);
assert.equal(raiseEvents[0].action, 'raise');
assert.equal(raiseEvents[0].amount, 600);

const explicitCheck = seats.map((s) => s.actorName === 'A' ? { ...s, visibleAction: 'check' } : s);
const checkEvents = inferEvents(prev, { handId: 8, street: 'flop', seats: assignPositions(explicitCheck) });
assert.equal(checkEvents.length, 1);
assert.equal(checkEvents[0].action, 'check');
assert.equal(checkEvents[0].source, 'table-action-text');

const inconsistentStack = callNextSeats.map((s) => s.actorName === 'E' ? { ...s, stack: 999, committed: 500 } : s);
assert.equal(inferEvents(
  { handId: 8, street: 'flop', seats: assignPositions(callNextSeats) },
  { handId: 8, street: 'flop', seats: assignPositions(inconsistentStack) },
).length, 0, 'chip increase without matching stack drop must abstain');

const noMovement = inferEvents(prev, { handId: 8, street: 'flop', seats: assignPositions(seats) });
assert.equal(noMovement.length, 0, 'no movement must never become check');

const tracker = new TableStateTracker();
tracker.resetHand(8);
const first = tracker.ingest({ handId: 8, street: 'preflop', confidence: .9, seats: seats.map((s) => ({ ...s, committed: s.actorName === 'Hero' ? 50 : s.actorName === 'D' ? 100 : 0 })) });
assert.equal(first.events.length, 0, 'first street snapshot is baseline; blinds are not actions');
const streetChange = tracker.ingest({ handId: 8, street: 'flop', confidence: .9, seats });
assert.equal(streetChange.events.length, 0, 'first snapshot of a street without explicit action is baseline');
const explicitOnBaseline = new TableStateTracker();
explicitOnBaseline.resetHand(9);
const baselineCheck = explicitOnBaseline.ingest({ handId: 9, street: 'flop', confidence: .9, seats: explicitCheck });
assert.equal(baselineCheck.events[0]?.action, 'check', 'explicit visible action is evidence even on first snapshot');

const endpoint = fs.readFileSync(new URL('../api/table-state.js', import.meta.url), 'utf8');
assert.match(endpoint, /replay mode required/i);
assert.match(endpoint, /Do NOT infer hidden cards/i);
assert.match(endpoint, /visibleAction MUST be null unless explicit action text/i);
assert.match(endpoint, /Never fabricate a player, action or numeric value/i);
assert.match(endpoint, /Precision is more important than coverage/i);

console.log('TABLE STATE TRACKER V1 regressions passed');
