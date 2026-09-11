import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { classifySuitMask, classifySuitPixels, SUIT_MASK_W, SUIT_MASK_H } from '../src/core/suit-classifier.js';
import { SuitConsensus } from '../src/core/suit-consensus.js';

function unpack(b64) {
  const bytes = Buffer.from(b64, 'base64');
  const out = new Uint8Array(SUIT_MASK_W * SUIT_MASK_H);
  for (let i = 0; i < out.length; i++) out[i] = bytes[i >> 3] & (1 << (i & 7)) ? 1 : 0;
  return out;
}

const samples = {
  spades: ['black', 'AAAAAAAAAAQAAAQAAB8AwH8AwH8A4P8B4P8B4P8D+P8D+P8D+P8P+P8P+P8P+P8D+P8D4OQB4OQBAAQAAB8AAB8AAAAAAAAA'],
  hearts: ['red', 'AAAAAAAAwIcPwIcP8P8/8P8//P8//P8//P8/8P8/8P8/8P8/8P8/wP8PwP8PgP8DgP8DgP8BAH4AAH4AABgAABgAAAAAAAAA'],
  clubs: ['black', 'AAAAAAAAAAQAAAQAAB8AwB8AwB8AAB8AAB8AABwA+P8D+P8D+P8P+P8P+P8P+OQD+OQDAAQAAAQAAAQAAB8AAB8AAAAAAAAA'],
  diamonds: ['red', 'AAAAAAAAAB8AAB8AAB8AwH8AwH8A4H8A4H8A4P8D+P8P+P8P+P8D+P8D4P8DwH8AwH8AwH8AwH8AAB8AAAcAAAcAAAAAAAAA'],
};

for (const [suit, [family, b64]] of Object.entries(samples)) {
  const out = classifySuitMask(unpack(b64), family);
  assert.equal(out.suit, suit, `${suit} calibration must classify itself`);
  assert(out.confidence >= 0.74, `${suit} calibration must be high confidence`);
}

function blankCard() {
  const w = 112, h = 88; const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 24; data[i + 1] = 105; data[i + 2] = 58; data[i + 3] = 255; }
  const card = { x: 14, y: 8, w: 84, h: 68 };
  for (let y = card.y; y < card.y + card.h; y++) for (let x = card.x; x < card.x + card.w; x++) {
    const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 246; data[i + 3] = 255;
  }
  return { data, w, h, card };
}
function drawMask(fixture, mask, family, ox, oy, size = 19) {
  const { data, w, card } = fixture;
  const rgb = family === 'red' ? [205, 28, 34] : [24, 24, 24];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
    const sx = Math.min(SUIT_MASK_W - 1, Math.floor(dx * SUIT_MASK_W / size));
    const sy = Math.min(SUIT_MASK_H - 1, Math.floor(dy * SUIT_MASK_H / size));
    if (!mask[sy * SUIT_MASK_W + sx]) continue;
    const x = card.x + ox + dx, y = card.y + oy + dy; const i = (y * w + x) * 4;
    data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
  }
}
function drawFakeRank(fixture) {
  const { data, w, card } = fixture;
  for (let y = card.y + 4; y < card.y + 25; y++) for (let x = card.x + 4; x < card.x + 18; x++) {
    if (x === card.x + 4 || x === card.x + 17 || y === card.y + 4 || y === card.y + 24) {
      const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 22;
    }
  }
}

function paintSyntheticPokerStarsCard(mask, family) {
  const fixture = blankCard(); drawFakeRank(fixture);
  drawMask(fixture, mask, family, 31, 5);
  drawMask(fixture, mask, family, 57, 5);
  drawMask(fixture, mask, family, 55, 36);
  return fixture;
}

const fixtures = [];
for (const [suit, [family, b64]] of Object.entries(samples)) {
  const fixture = paintSyntheticPokerStarsCard(unpack(b64), family);
  fixtures.push([suit, fixture]);
  const out = classifySuitPixels(fixture.data, fixture.w, fixture.h);
  assert.equal(out.suit, suit, `${suit} must be extracted from suit pips, not rank glyph`);
  assert(out.voteCount >= 2 || out.confidence >= 0.88, `${suit} needs multi-window support or a very strong single read`);
}

// Real-replay failure shape: A/J/Q/K have one authoritative corner glyph while
// the right side can contain a PokerStars watermark or face artwork. A rank-aware
// read must ignore that distractor.
function paintFaceCard(correctSuit, distractorSuit) {
  const fixture = blankCard(); drawFakeRank(fixture);
  const [cf, cb64] = samples[correctSuit];
  const [df, db64] = samples[distractorSuit];
  drawMask(fixture, unpack(cb64), cf, 4, 30, 17);       // true corner suit under rank
  drawMask(fixture, unpack(db64), df, 47, 8, 25);       // misleading face/watermark region
  drawMask(fixture, unpack(db64), df, 52, 35, 22);
  return fixture;
}
const aceClub = paintFaceCard('clubs', 'spades');
const aceOut = classifySuitPixels(aceClub.data, aceClub.w, aceClub.h, 'A');
assert.equal(aceOut.suit, 'clubs', 'A♣ must use the corner glyph and ignore right-side spade-like decoration');
assert.equal(aceOut.roi, 'corner-under-rank');
const queenHeart = paintFaceCard('hearts', 'diamonds');
const queenOut = classifySuitPixels(queenHeart.data, queenHeart.w, queenHeart.h, 'Q');
assert.equal(queenOut.suit, 'hearts', 'Q♥ must use the corner glyph and ignore face-card artwork');
assert.equal(queenOut.roi, 'corner-under-rank');

// Temporal suit consensus: one frame never becomes authoritative. Two agreeing
// reads do for numeric cards; A/J/Q/K require three agreeing frames.
const heroConsensus = new SuitConsensus({ slots: 2, windowMs: 320 });
heroConsensus.resetHand(7);
const hero = [
  { rank: '9', suit: 'clubs', suitConfidence: .91, voteCount: 2 },
  { rank: '4', suit: 'diamonds', suitConfidence: .93, voteCount: 2 },
];
let stable = heroConsensus.observe(hero, { handId: 7, now: 0 });
assert.equal(stable.confirmedCount, 0, 'one suit frame is not authoritative');
stable = heroConsensus.observe(hero, { handId: 7, now: 55 });
assert.equal(stable.confirmedCount, 2, 'two agreeing fast frames confirm both numeric hero suits');
assert.equal(stable.cards[0].suit, 'clubs');
assert.equal(stable.cards[1].suit, 'diamonds');
stable = heroConsensus.observe([
  { rank: '9', suit: 'spades', suitConfidence: .99, voteCount: 3 },
  { rank: '4', suit: 'hearts', suitConfidence: .99, voteCount: 3 },
], { handId: 7, now: 110 });
assert.equal(stable.cards[0].suit, 'clubs', 'confirmed hero suit is sticky within a hand');
assert.equal(stable.cards[1].suit, 'diamonds', 'confirmed hero suit is sticky within a hand');

const faceConsensus = new SuitConsensus({ slots: 2, windowMs: 360 });
faceConsensus.resetHand(9);
const faceHero = [
  { rank: 'A', suit: 'clubs', suitConfidence: .93, voteCount: 1 },
  { rank: 'K', suit: 'hearts', suitConfidence: .94, voteCount: 1 },
];
assert.equal(faceConsensus.observe(faceHero, { handId: 9, now: 0 }).confirmedCount, 0);
assert.equal(faceConsensus.observe(faceHero, { handId: 9, now: 55 }).confirmedCount, 0, 'two face-card reads are still provisional');
assert.equal(faceConsensus.observe(faceHero, { handId: 9, now: 110 }).confirmedCount, 2, 'three agreeing face-card reads confirm quickly');

const boardConsensus = new SuitConsensus({ slots: 5, windowMs: 360 });
boardConsensus.resetHand(8);
const flop = [
  { rank: 'A', suit: 'spades', suitConfidence: .9, voteCount: 1 },
  { rank: 'T', suit: 'hearts', suitConfidence: .9, voteCount: 2 },
  { rank: '3', suit: 'clubs', suitConfidence: .9, voteCount: 2 },
];
assert.equal(boardConsensus.observe(flop, { handId: 8, now: 0 }).confirmedCount, 0);
assert.equal(boardConsensus.observe(flop, { handId: 8, now: 60 }).confirmedCount, 2, 'numeric board suits confirm after two reads while ace waits');
assert.equal(boardConsensus.observe(flop, { handId: 8, now: 120 }).confirmedCount, 3, 'ace suit confirms on the third agreeing read');

// Performance gate: this is a local detector and must stay cheap.
const loops = 120;
const t0 = performance.now();
let calls = 0;
for (let n = 0; n < loops; n++) {
  for (const [expected, fixture] of fixtures) {
    const out = classifySuitPixels(fixture.data, fixture.w, fixture.h);
    assert.equal(out.suit, expected);
    calls++;
  }
  assert.equal(classifySuitPixels(aceClub.data, aceClub.w, aceClub.h, 'A').suit, 'clubs'); calls++;
  assert.equal(classifySuitPixels(queenHeart.data, queenHeart.w, queenHeart.h, 'Q').suit, 'hearts'); calls++;
}
const avgMs = (performance.now() - t0) / calls;
assert(avgMs < 5, `suit classifier average ${avgMs.toFixed(3)}ms exceeded 5ms budget`);
console.log(`Suit classifier avg ${avgMs.toFixed(3)}ms across ${calls} calls`);

const resolverRuntime = fs.readFileSync(new URL('../src/solver/resolver-runtime.js', import.meta.url), 'utf8');
assert.match(resolverRuntime, /completeCard/);
assert.match(resolverRuntime, /LENDO NAIPE/);
assert.match(resolverRuntime, /publishDecision/);
assert.match(resolverRuntime, /MutationObserver/);
assert.match(resolverRuntime, /source: 'resolver-local'/);

const refinerRuntime = fs.readFileSync(new URL('../src/vision/card-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(refinerRuntime, /HeroCardConsensus/);
assert.match(refinerRuntime, /SuitConsensus/);
assert.match(refinerRuntime, /classifySuitPixels/);
assert.match(refinerRuntime, /classifySuitPixels\(crop\.data, crop\.w, crop\.h, rank\.rank/);
assert.match(refinerRuntime, /machine\.setHero =/);
assert.match(refinerRuntime, /machine\.setBoard =/);
assert.match(refinerRuntime, /suitConfidence/);

console.log('SUIT READER V3 regressions passed');
