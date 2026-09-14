import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BoardCardConsensus } from '../src/core/board-card-consensus.js';
import { SuitConsensus } from '../src/core/suit-consensus.js';
import { mergeHeroCardFragments, locateHeroPairRects } from '../src/detectors/hero-card-locator.js';

const c = (rank, suit = null, confidence = 0.95, suitConfidence = 0.95) => ({
  rank,
  suit,
  confidence,
  suitConfidence,
});

// Hero rank consensus uses the same primitive as the board. One isolated bad
// frame must not become a locked card; three agreeing clean frames do.
const ranks = new BoardCardConsensus({ slots: 2, windowMs: 1000, minHits: 3 });
ranks.resetHand(42);
let out = ranks.observe([c('8'), c('T')], { handId: 42, now: 100 });
assert.equal(out.ready, false);
assert.equal(out.confirmedCount, 0);

out = ranks.observe([c('T'), c('T')], { handId: 42, now: 180 });
assert.equal(out.ready, false);
out = ranks.observe([c('T'), c('T')], { handId: 42, now: 260 });
assert.equal(out.ready, false, 'two matching rank frames are intentionally not enough');
out = ranks.observe([c('T'), c('T')], { handId: 42, now: 340 });
assert.equal(out.ready, true);
assert.deepEqual(out.cards.map((card) => card.rank), ['T', 'T']);

// Suits independently require temporal agreement. A complete Hero identity is
// not available until both slots are confirmed.
const suits = new SuitConsensus({ slots: 2, windowMs: 1000, allowFacePairCandidates: true, allowCandidates: true, candidateMinHits: 4 });
suits.resetHand(42);
out = suits.observe([c('T', 'clubs'), c('T', 'diamonds')], { handId: 42, now: 400 });
assert.equal(out.confirmedCount, 0);
out = suits.observe([c('T', 'clubs'), c('T', 'diamonds')], { handId: 42, now: 480 });
assert.equal(out.confirmedCount, 2);
assert.deepEqual(out.cards.map((card) => card.suit), ['clubs', 'diamonds']);

// Regression from a real PokerStars replay frame: the white-mask detector can
// split card 1 into two narrow pieces because red/black glyph columns interrupt
// the white run. Those two fragments must be merged BEFORE choosing the Hero
// pair, otherwise the locator mistakes both halves of card 1 for the two cards.
{
  const fragments = [
    { x: 136, y: 55, w: 32, h: 46 },
    { x: 168, y: 55, w: 32, h: 46 },
    { x: 202, y: 55, w: 64, h: 62 },
  ];
  const merged = mergeHeroCardFragments(fragments);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].x, 136);
  assert.equal(merged[0].w, 64);
  assert.equal(merged[1].x, 202);
}

// End-to-end raw-pixel version of the same failure shape.
{
  const w = 400;
  const h = 120;
  const data = new Uint8ClampedArray(w * h * 4);
  const fill = (x0, y0, rw, rh, rgb) => {
    for (let y = y0; y < Math.min(h, y0 + rh); y++) {
      for (let x = x0; x < Math.min(w, x0 + rw); x++) {
        const i = (y * w + x) * 4;
        data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
      }
    }
  };
  fill(0, 0, w, h, [28, 92, 48]);
  fill(136, 55, 31, 48, [245, 245, 245]);
  fill(170, 55, 30, 48, [245, 245, 245]);
  fill(167, 55, 3, 48, [185, 25, 35]);
  fill(202, 55, 64, 62, [245, 245, 245]);
  const pair = locateHeroPairRects(data, w, h);
  assert.ok(pair, 'split first card + complete second card must resolve to a Hero pair');
  assert.equal(pair.length, 2);
  assert.ok(pair[0].w >= 58, `first physical card should be merged, got width ${pair[0].w}`);
  assert.ok(pair[1].w >= 58, `second physical card should remain complete, got width ${pair[1].w}`);
}

const runtime = fs.readFileSync(new URL('../src/vision/hero-refiner-runtime-r14.js', import.meta.url), 'utf8');
const rescue = fs.readFileSync(new URL('../src/vision/hero-auto-rescue-r14.js', import.meta.url), 'utf8');
const authority = fs.readFileSync(new URL('../src/vision/manual-hero-authority-r14.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../src/vision/manual-hero-entry-r14.js', import.meta.url), 'utf8');
const continuity = fs.readFileSync(new URL('../src/vision/hero-continuity-guard-r14.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/core/decision-store.js', import.meta.url), 'utf8');

assert.match(runtime, /windowMs: 680, minHits: 3/);
assert.match(runtime, /windowMs: 780/);
assert.match(runtime, /candidateMinHits: 4/);
assert.match(runtime, /pairHits < 2/);
assert.match(runtime, /T' && second === '8'/);
assert.match(runtime, /new OcrService\(\)/);
assert.match(runtime, /ocr\.readRank\(rankCrop\(crop\.canvas\), 'hero'\)/);
assert.match(runtime, /layout\?\.heroSuitSlots/);
assert.match(runtime, /source: 'replay-auto'/);
assert.match(runtime, /replay\?\.sourceKind === 'video-file'/);
assert.match(runtime, /replay\?\.sourceKind === 'image-file'/);
assert.match(runtime, /replay\?\.screenReplayReady === true/);
assert.match(runtime, /replay\?\.sourceKind === 'screen-replay'/);
assert.match(runtime, /diagnostics\.fallbackReady = false/);
assert.doesNotMatch(runtime, /fallbackReady = now - startedAt/);
assert.doesNotMatch(runtime, /machine\.newHand/);

assert.match(rescue, /function choosePhysicalSlots\(frame\)/);
assert.match(rescue, /return located/);
assert.match(rescue, /hero-full-geometry/);
assert.doesNotMatch(rescue, /candidates\.sort/);
assert.match(rescue, /const rankCrops = physicalSlots\.map/);
assert.match(rescue, /const suitCrops = physicalSlots\.map/);
assert.match(rescue, /directConsensus/);
assert.match(rescue, /directPairHits >= 2/);
assert.match(rescue, /commitCards\(directCards, \{ direct: true \}\)/);
assert.match(rescue, /minHits: 2/);
assert.match(rescue, /source: 'hero-auto-rescue-direct'/);

assert.match(authority, /replay\?\.screenReplayReady === true/);
assert.match(authority, /replay\?\.sourceKind === 'screen-replay'/);
assert.match(authority, /authority\.heroSource === 'manual'/);
assert.match(authority, /return sameCards\(machine\.state\.hero \|\| \[\], cards \|\| \[\]\)/);
assert.match(entry, /if \(autoReaderOwnsCurrentAttempt\(\)\) return/);
assert.match(entry, /prc:hero-auto-confirmed/);
assert.match(continuity, /DEALER_CONFIRM_HITS = 2/);
assert.match(continuity, /potResetAccepted: false/);
assert.match(store, /clockStartsAfterHeroConfirmation: true/);
assert.match(store, /relógio estratégico ainda NÃO começou/);

console.log('HERO AUTO REFINER R14 passed');
