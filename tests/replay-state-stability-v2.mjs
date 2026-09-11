import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SuitConsensus } from '../src/core/suit-consensus.js';
import { inferEvents } from '../src/core/table-state-tracker.js';

// Real replay regression: same-rank face pairs such as QQ can have both ranks
// confirmed while the glyph classifier is slightly below the normal hard-suit
// threshold. Repeated distinct candidates may resolve the suits, but only after
// temporal evidence. Duplicate candidates must never manufacture an impossible
// exact duplicate card.
const pair = new SuitConsensus({ windowMs: 500, slots: 2, allowFacePairCandidates: true });
pair.resetHand(7);
const qq = [
  { rank: 'Q', suit: null, suitCandidate: 'spades', suitCandidateConfidence: .56, suitMargin: .021, suitDistance: .54 },
  { rank: 'Q', suit: null, suitCandidate: 'clubs', suitCandidateConfidence: .55, suitMargin: .019, suitDistance: .55 },
];
for (const t of [0, 70, 140]) {
  const out = pair.observe(qq, { handId: 7, now: t });
  assert.equal(out.confirmedCount, 0, 'face-pair candidates need four agreeing frames');
}
const qqDone = pair.observe(qq, { handId: 7, now: 210 });
assert.deepEqual(qqDone.suits, ['spades','clubs']);
assert.equal(qqDone.confirmedCount, 2);

const impossible = new SuitConsensus({ windowMs: 500, slots: 2, allowFacePairCandidates: true });
impossible.resetHand(8);
const same = [
  { rank: 'K', suit: null, suitCandidate: 'hearts', suitCandidateConfidence: .62, suitMargin: .03, suitDistance: .5 },
  { rank: 'K', suit: null, suitCandidate: 'hearts', suitCandidateConfidence: .61, suitMargin: .028, suitDistance: .51 },
];
for (const t of [0, 70, 140, 210, 280]) impossible.observe(same, { handId: 8, now: t });
assert.equal(impossible.snapshot().confirmed.filter(Boolean).length, 0, 'same-rank Hero cards cannot soft-confirm the same suit');

// Visual action reconstruction must use physical seat identity. OCR player names
// are labels and can drift by a character between snapshots without losing the
// betting event.
const previous = {
  handId: 3,
  street: 'preflop',
  seats: [
    { seatIndex: 2, actorName: 'Brainybrams', stack: 50000, committed: 0, dealer: false, folded: false, hero: false, visibleAction: null, visibleActionAmount: null, confidence: .92, position: 'CO' },
    { seatIndex: 3, actorName: 'Raiser', stack: 49500, committed: 500, dealer: false, folded: false, hero: false, visibleAction: null, visibleActionAmount: null, confidence: .94, position: 'BTN' },
  ],
};
const next = {
  handId: 3,
  street: 'preflop',
  seats: [
    { seatIndex: 2, actorName: null, stack: 49500, committed: 500, dealer: false, folded: false, hero: false, visibleAction: null, visibleActionAmount: null, confidence: .91, position: 'CO' },
    { seatIndex: 3, actorName: 'Raiser', stack: 49500, committed: 500, dealer: false, folded: false, hero: false, visibleAction: null, visibleActionAmount: null, confidence: .94, position: 'BTN' },
  ],
};
const events = inferEvents(previous, next);
assert.equal(events.length, 1);
assert.equal(events[0].action, 'call');
assert.equal(events[0].actorName, 'Brainybrams', 'previous readable name should survive a later OCR miss on the same seat');
assert.equal(events[0].amount, 500);

const runtime = fs.readFileSync(new URL('../src/vision/card-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(runtime, /allowFacePairCandidates: true/);
assert.match(runtime, /suitCandidateConfidence/);
const api = fs.readFileSync(new URL('../api/table-state.js', import.meta.url), 'utf8');
assert.match(api, /production && !tokenMatches\(accessToken, providedToken\)/, 'production remains token protected while preview can auto-probe');
const tableObserver = fs.readFileSync(new URL('../src/vision/table-observer.js', import.meta.url), 'utf8');
assert.match(tableObserver, /minIntervalMs = 1350/);
assert.doesNotMatch(tableObserver, /!this\.accessToken/);

console.log('REPLAY STATE STABILITY V2 regressions passed');
