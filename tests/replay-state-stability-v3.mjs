import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BoardCardConsensus } from '../src/core/board-card-consensus.js';
import { SuitConsensus } from '../src/core/suit-consensus.js';

const board = new BoardCardConsensus({ windowMs: 500, slots: 5, minHits: 3 });
board.resetHand(11);
const good = [
  { rank: '3', confidence: .91 },
  { rank: '2', confidence: .92 },
  { rank: '6', confidence: .93 },
];
const bad = [
  { rank: '5', confidence: .99 },
  { rank: '2', confidence: .99 },
  { rank: '6', confidence: .99 },
];
assert.equal(board.observe(bad, { handId: 11, now: 0 }).ready, false);
assert.equal(board.observe(bad, { handId: 11, now: 50 }).ready, false);
assert.equal(board.observe(good, { handId: 11, now: 100 }).ready, false);
assert.equal(board.observe(good, { handId: 11, now: 150 }).ready, false);
assert.equal(board.observe(good, { handId: 11, now: 200 }).ready, false, 'conflicting startup history requires one more clean frame');
const stable = board.observe(good, { handId: 11, now: 250 });
assert.equal(stable.ready, true);
assert.deepEqual(stable.ranks, ['3','2','6']);
assert.deepEqual(board.observe(bad, { handId: 11, now: 300 }).ranks, ['3','2','6'], 'confirmed flop cannot mutate after a later 3↔5 flicker');

const pair = new SuitConsensus({ windowMs: 500, slots: 2, allowFacePairCandidates: true });
pair.resetHand(12);
for (const t of [0, 70, 140]) {
  pair.observe([
    { rank: 'Q', suit: 'spades', suitConfidence: .94, voteCount: 2 },
    { rank: 'Q', suit: null, suitCandidate: 'clubs', suitCandidateConfidence: .54, suitMargin: .018, suitDistance: .55 },
  ], { handId: 12, now: t });
}
assert.deepEqual(pair.snapshot().confirmed, ['spades','clubs']);

const runtime = fs.readFileSync(new URL('../src/vision/card-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(runtime, /BoardCardConsensus/);
assert.match(runtime, /boardRankConsensus\.observe/);
const coach = fs.readFileSync(new URL('../src/coach/coach-runtime.js', import.meta.url), 'utf8');
assert.match(coach, /Mesa visual ativa/);
assert.match(coach, /recentVisualHistory/);
assert.match(coach, /latestAction/);

console.log('REPLAY STATE STABILITY V3 regressions passed');
