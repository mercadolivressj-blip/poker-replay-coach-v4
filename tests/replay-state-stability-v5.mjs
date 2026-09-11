import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SuitConsensus } from '../src/core/suit-consensus.js';

const weak = (rank, candidate) => ({
  rank,
  suit: null,
  suitConfidence: 0,
  suitCandidate: candidate,
  suitCandidateConfidence: 0.16,
  suitMargin: 0.012,
  suitDistance: 0.54,
  voteCount: 0,
});

{
  const s = new SuitConsensus({ windowMs: 520, slots: 5, allowCandidates: true, candidateMinHits: 4 });
  s.resetHand(7);
  const board = [weak('2', 'hearts'), weak('T', 'diamonds'), weak('5', 'clubs')];
  let r = s.observe(board, { handId: 7, now: 0 });
  assert.deepEqual(r.suits, [null, null, null]);
  r = s.observe(board, { handId: 7, now: 85 });
  assert.deepEqual(r.suits, [null, null, null]);
  r = s.observe(board, { handId: 7, now: 170 });
  assert.deepEqual(r.suits, [null, null, null], 'three weak frames are not enough');
  r = s.observe(board, { handId: 7, now: 255 });
  assert.deepEqual(r.suits, ['hearts', 'diamonds', 'clubs'], 'four stable board candidates should confirm suits');
  assert.equal(r.confirmedCount, 3);
}

{
  const s = new SuitConsensus({ windowMs: 520, slots: 5, allowCandidates: true, candidateMinHits: 4 });
  s.resetHand(8);
  const h = [weak('2', 'hearts')];
  const d = [weak('2', 'diamonds')];
  s.observe(h, { handId: 8, now: 0 });
  s.observe(d, { handId: 8, now: 70 });
  s.observe(h, { handId: 8, now: 140 });
  let r = s.observe(d, { handId: 8, now: 210 });
  assert.equal(r.suits[0], null, '2-vs-2 candidate conflict must remain unknown');
}

{
  const s = new SuitConsensus({ windowMs: 520, slots: 5, allowCandidates: true, candidateMinHits: 4 });
  s.resetHand(9);
  for (let i = 0; i < 3; i++) s.observe([weak('3', 'spades')], { handId: 9, now: i * 70 });
  let r = s.observe([weak('5', 'clubs')], { handId: 9, now: 230 });
  assert.equal(r.suits[0], null, 'new rank must clear old suit candidate history');
}

const runtime = fs.readFileSync(new URL('../src/vision/card-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(runtime, /boardSuitConsensus = new SuitConsensus\(\{ windowMs: 620, slots: 5, allowCandidates: true, candidateMinHits: 4 \}\)/);

console.log('REPLAY STATE STABILITY V5 board-suit regressions passed');
