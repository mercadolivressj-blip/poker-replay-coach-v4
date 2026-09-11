import assert from 'node:assert/strict';
import fs from 'node:fs';
import { layoutFromFelt } from '../src/core/geometry.js';
import { HeroCardConsensus } from '../src/core/hero-card-consensus.js';

// Calibrated from the real replay screenshots that produced A? 9♥ and K? T♣.
// The physical Hero card top sits around 0.90 felt-heights below the felt top.
// The historical fast-rank slot intentionally starts lower (0.94); the suit
// refiner needs its own crop so the tiny corner glyph is not cut off.
const felt = { x: 0.24, y: 0.23, w: 0.582, h: 0.487 };
const layout = layoutFromFelt(felt);
assert.equal(layout.heroSlots.length, 2);
assert.equal(layout.heroSuitSlots.length, 2);
assert.equal(layout.boardSlots.length, 5);

for (let i = 0; i < 2; i++) {
  const fast = layout.heroSlots[i];
  const suit = layout.heroSuitSlots[i];
  const realCardTop = felt.y + 0.90 * felt.h;
  assert(suit.y <= realCardTop, `hero suit slot ${i} must include the real card top`);
  assert(fast.y > realCardTop, `legacy fast slot ${i} should remain untouched and lower`);
  assert(suit.y < fast.y, `hero suit slot ${i} must start above the fast rank slot`);
  assert(suit.h > fast.h, `hero suit slot ${i} must retain more of the physical card`);
  assert(Math.abs(suit.x - fast.x) < 1e-9, `hero suit slot ${i} must not drift horizontally`);
  assert(Math.abs(suit.w - fast.w) < 1e-9, `hero suit slot ${i} must keep proven horizontal width`);
}

// Guard the board geometry: this fix is Hero-only because the board was already
// reading rank+suit correctly in the same real replays.
assert(Math.abs(layout.boardSlots[0].y - (felt.y + 0.265 * felt.h)) < 1e-9);
assert(Math.abs(layout.boardSlots[0].h - 0.29 * felt.h) < 1e-9);

// Real failure shape from replay testing: hand #1 confirms correctly, the table
// rolls into hand #2, the legacy fast crop emits a contradictory rank candidate,
// and the dedicated Hero refiner sees the real new hand. Three strong refiner
// frames must win without being vetoed by fast-path noise.
const rollover = new HeroCardConsensus({ windowMs: 520, strongConfidence: 0.76 });
const firstHand = [
  { rank: 'A', suit: 'clubs', confidence: 0.94, source: 'card-refiner-local' },
  { rank: '9', suit: 'hearts', confidence: 0.93, source: 'card-refiner-local' },
];
rollover.resetHand(1);
assert.equal(rollover.observe(firstHand, { handId: 1, now: 0, source: 'refiner' }).accepted, false);
assert.equal(rollover.observe(firstHand, { handId: 1, now: 65, source: 'refiner' }).accepted, false);
let accepted = rollover.observe(firstHand, { handId: 1, now: 130, source: 'refiner' });
assert.equal(accepted.accepted, true, 'first hand should confirm from dedicated refiner');
assert.equal(accepted.key, 'A9');

rollover.resetHand(2);
const noisyFast = [
  { rank: 'J', confidence: 0.96, source: 'seeded-template' },
  { rank: '2', confidence: 0.95, source: 'seeded-template' },
];
const secondHand = [
  { rank: '8', suit: 'spades', confidence: 0.94, source: 'card-refiner-local' },
  { rank: '2', suit: 'hearts', confidence: 0.93, source: 'card-refiner-local' },
];
assert.equal(rollover.observe(noisyFast, { handId: 2, now: 0, source: 'fast' }).accepted, false);
assert.equal(rollover.observe(secondHand, { handId: 2, now: 25, source: 'refiner' }).accepted, false);
assert.equal(rollover.observe(noisyFast, { handId: 2, now: 70, source: 'fast' }).accepted, false);
assert.equal(rollover.observe(secondHand, { handId: 2, now: 90, source: 'refiner' }).accepted, false);
assert.equal(rollover.observe(noisyFast, { handId: 2, now: 135, source: 'fast' }).accepted, false, 'three fast noisy frames must not lock the wrong new hand');
accepted = rollover.observe(secondHand, { handId: 2, now: 155, source: 'refiner' });
assert.equal(accepted.accepted, true, 'three strong refiner frames must resolve the second hand');
assert.equal(accepted.key, '82');
assert.equal(accepted.reason, 'refiner-consensus');

const runtime = fs.readFileSync(new URL('../src/vision/card-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(runtime, /const heroRankSlots = layout\.heroSlots/, 'Hero rank must keep the proven legacy rank geometry');
assert.match(runtime, /layout\.heroSuitSlots \|\| layout\.heroSlots/, 'Hero refiner must consume dedicated suit geometry');
assert.match(runtime, /function classifyHeroCard\(rankSlotCrop, suitSlotCrop/, 'Hero rank and suit must use separate crop inputs');
assert.match(runtime, /confirmedRank/, 'Hero suit refinement must preserve the already-confirmed rank');
assert.match(runtime, /classifySuitPixels\(suitSlotCrop\.data, suitSlotCrop\.w, suitSlotCrop\.h, rank\)/, 'Hero refiner must classify suit using the rank while reading the dedicated suit crop');
assert.match(runtime, /classifyRankPixels\(rankSlotCrop\.data, rankSlotCrop\.w, rankSlotCrop\.h\)/, 'Hero refiner must never read rank from the suit crop');
assert.match(runtime, /function syncCardHand/, 'card refiner must explicitly reset Hero and board consensus on hand rollover');
assert.match(runtime, /heroBurstUntil = now \+ 420/, 'new hand should trigger a bounded foreground card read burst');
assert.match(runtime, /return 'refiner'/, 'dedicated Hero refiner must have an explicit consensus source');
assert.match(runtime, /const boardCrops = layout\.boardSlots/, 'board path must remain on the proven board geometry');

console.log('HERO SUIT READER V1 regressions passed');
