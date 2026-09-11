import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BoardCardConsensus } from '../src/core/board-card-consensus.js';
import { HandMachine } from '../src/core/state-machine.js';

// Board rank lock must not erase later live suit evidence. This reproduces the
// replay symptom where 5/3/3 ranks were right but every suit stayed unknown.
const board = new BoardCardConsensus({ windowMs: 500, slots: 5, minHits: 3 });
board.resetHand(21);
const noSuit = [
  { rank: '5', suit: null, suitCandidate: null, confidence: .92 },
  { rank: '3', suit: null, suitCandidate: null, confidence: .93 },
  { rank: '3', suit: null, suitCandidate: null, confidence: .94 },
];
for (const t of [0, 60, 120]) board.observe(noSuit, { handId: 21, now: t });
const withSuit = [
  { rank: '5', suit: 'diamonds', suitCandidate: 'diamonds', suitCandidateConfidence: .92, confidence: .93 },
  { rank: '3', suit: 'spades', suitCandidate: 'spades', suitCandidateConfidence: .91, confidence: .93 },
  { rank: '3', suit: 'diamonds', suitCandidate: 'diamonds', suitCandidateConfidence: .91, confidence: .94 },
];
const stable = board.observe(withSuit, { handId: 21, now: 180 });
assert.equal(stable.ready, true);
assert.deepEqual(stable.cards.map((c) => c.suit), ['diamonds','spades','diamonds']);
assert.deepEqual(stable.cards.map((c) => c.suitCandidate), ['diamonds','spades','diamonds']);

// Brief board dropouts while Hero remains visible must not roll handId. PokerStars
// animation/chip overlap can make the board detector report zero for several frames.
const m = new HandMachine();
m.newHand('fixture', 1000);
const id = m.handId;
m.lastBoardCountVisual = 3;
m.lastHeroSeenAt = 1100;
m.heroMissing = 0;
for (let i = 0; i < 7; i++) {
  const out = m.observeBoardCount(0, 1200 + i * 80);
  assert.equal(out.newHand, false);
  assert.equal(m.handId, id);
}
// Even after the old two-hit threshold, a visible Hero protects the current hand.
const stillSame = m.observeBoardCount(0, 1900);
assert.equal(stillSame.newHand, false);
assert.equal(m.handId, id);
// A sustained board + Hero disappearance can still serve as fallback hand boundary.
m.heroMissing = 10;
m.lastHeroSeenAt = 1300;
const rollover = m.observeBoardCount(0, 2050);
assert.equal(rollover.newHand, true);
assert.equal(m.handId, id + 1);

// Runtime contract: Hero rank and suit must come from separate geometries. The
// dedicated suit crop is never allowed to invent or replace rank.
const runtime = fs.readFileSync(new URL('../src/vision/card-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(runtime, /const heroRankSlots = layout\.heroSlots/);
assert.match(runtime, /const heroSuitSlots = layout\.heroSuitSlots \|\| layout\.heroSlots/);
assert.match(runtime, /classifyHeroCard\(rankSlotCrop, suitSlotCrop/);
assert.match(runtime, /classifyRankPixels\(rankSlotCrop\.data, rankSlotCrop\.w, rankSlotCrop\.h\)/);
assert.match(runtime, /classifySuitPixels\(suitSlotCrop\.data, suitSlotCrop\.w, suitSlotCrop\.h, rank\)/);
assert.doesNotMatch(runtime, /classifyLocalCard\(suitSlotCrop\)/);

console.log('REPLAY STATE STABILITY V4 regressions passed');
