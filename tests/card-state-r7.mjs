import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SuitConsensus } from '../src/core/suit-consensus.js';

const hero = new SuitConsensus({ windowMs: 420, slots: 2, allowFacePairCandidates: true, candidateMinHits: 3 });
hero.resetHand(7);

const weakTc = {
  rank: 'T', suit: null, suitCandidate: 'clubs', suitCandidateConfidence: 0.31,
  suitMargin: 0.018, suitDistance: 0.48, confidence: 0.91,
};
const hard6c = {
  rank: '6', suit: 'clubs', suitConfidence: 0.91, confidence: 0.94,
};

let out = hero.observe([weakTc, hard6c], { handId: 7, now: 0 });
assert.equal(out.cards[0].suit, null, 'one weak T-clubs frame must not guess');
out = hero.observe([weakTc, hard6c], { handId: 7, now: 60 });
assert.equal(out.cards[0].suit, null, 'two weak T-clubs frames still collect evidence');
out = hero.observe([weakTc, hard6c], { handId: 7, now: 120 });
assert.equal(out.cards[0].suit, 'clubs', 'three consistent Hero suit candidates should confirm T-clubs');
assert.equal(out.cards[1].suit, 'clubs', 'hard 6-clubs evidence remains confirmed');

// Once a suit is confirmed inside one hand, later unknown or conflicting soft
// frames must never regress it back to '?'.
out = hero.observe([
  { ...weakTc, suitCandidate: 'hearts', suitCandidateConfidence: 0.22, suitMargin: 0.006 },
  { ...hard6c, suit: null, suitCandidate: 'diamonds', suitCandidateConfidence: 0.2, suitMargin: 0.005, suitDistance: 0.6 },
], { handId: 7, now: 180 });
assert.equal(out.cards[0].suit, 'clubs');
assert.equal(out.cards[1].suit, 'clubs');

const runtime = fs.readFileSync(new URL('../src/vision/card-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(runtime, /function syncCardHand/);
assert.match(runtime, /consensus\.resetHand\(machine\.handId\)/);
assert.match(runtime, /heroSuitConsensus\.resetHand\(machine\.handId\)/);
assert.match(runtime, /boardRankConsensus\.resetHand\(machine\.handId\)/);
assert.match(runtime, /boardSuitConsensus\.resetHand\(machine\.handId\)/);
assert.match(runtime, /layout = null/);
assert.match(runtime, /candidateMinHits: 3/);

console.log('CARD STATE R7 regressions passed');
