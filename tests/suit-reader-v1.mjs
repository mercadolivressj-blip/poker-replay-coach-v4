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

function paintSyntheticPokerStarsCard(mask, family) {
  const w = 112, h = 88; const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 24; data[i + 1] = 105; data[i + 2] = 58; data[i + 3] = 255; }
  const card = { x: 14, y: 8, w: 84, h: 68 };
  for (let y = card.y; y < card.y + card.h; y++) for (let x = card.x; x < card.x + card.w; x++) {
    const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 246; data[i + 3] = 255;
  }
  // Large fake rank at the left edge. Suit extraction must never confuse it
  // with one of the repeated PokerStars suit pips.
  for (let y = card.y + 5; y < card.y + 27; y++) for (let x = card.x + 4; x < card.x + 18; x++) {
    if (x === card.x + 4 || x === card.x + 17 || y === card.y + 5 || y === card.y + 26) {
      const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 22;
    }
  }
  const rgb = family === 'red' ? [205, 28, 34] : [24, 24, 24];
  const drawMask = (ox, oy) => {
    const size = 19;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const sx = Math.min(SUIT_MASK_W - 1, Math.floor(dx * SUIT_MASK_W / size));
      const sy = Math.min(SUIT_MASK_H - 1, Math.floor(dy * SUIT_MASK_H / size));
      if (!mask[sy * SUIT_MASK_W + sx]) continue;
      const x = ox + dx, y = oy + dy; const i = (y * w + x) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
  };
  drawMask(card.x + 31, card.y + 5);
  drawMask(card.x + 57, card.y + 5);
  drawMask(card.x + 55, card.y + 36);
  return { data, w, h };
}

const fixtures = [];
for (const [suit, [family, b64]] of Object.entries(samples)) {
  const fixture = paintSyntheticPokerStarsCard(unpack(b64), family);
  fixtures.push([suit, fixture]);
  const out = classifySuitPixels(fixture.data, fixture.w, fixture.h);
  assert.equal(out.suit, suit, `${suit} must be extracted from suit pips, not rank glyph`);
  assert(out.voteCount >= 2 || out.confidence >= 0.88, `${suit} needs multi-window support or a very strong single read`);
}

// Temporal suit consensus: one frame never becomes authoritative. Two agreeing
// reads do; a conflicting later frame cannot mutate the confirmed suit.
const heroConsensus = new SuitConsensus({ slots: 2, windowMs: 320 });
heroConsensus.resetHand(7);
const hero = [
  { rank: '9', suit: 'clubs', suitConfidence: .91, voteCount: 2 },
  { rank: '4', suit: 'diamonds', suitConfidence: .93, voteCount: 2 },
];
let stable = heroConsensus.observe(hero, { handId: 7, now: 0 });
assert.equal(stable.confirmedCount, 0, 'one suit frame is not authoritative');
stable = heroConsensus.observe(hero, { handId: 7, now: 55 });
assert.equal(stable.confirmedCount, 2, 'two agreeing fast frames confirm both hero suits');
assert.equal(stable.cards[0].suit, 'clubs');
assert.equal(stable.cards[1].suit, 'diamonds');
stable = heroConsensus.observe([
  { rank: '9', suit: 'spades', suitConfidence: .99, voteCount: 3 },
  { rank: '4', suit: 'hearts', suitConfidence: .99, voteCount: 3 },
], { handId: 7, now: 110 });
assert.equal(stable.cards[0].suit, 'clubs', 'confirmed hero suit is sticky within a hand');
assert.equal(stable.cards[1].suit, 'diamonds', 'confirmed hero suit is sticky within a hand');

const boardConsensus = new SuitConsensus({ slots: 5, windowMs: 360 });
boardConsensus.resetHand(8);
const flop = [
  { rank: 'A', suit: 'spades', suitConfidence: .9, voteCount: 1 },
  { rank: 'T', suit: 'hearts', suitConfidence: .9, voteCount: 2 },
  { rank: '3', suit: 'clubs', suitConfidence: .9, voteCount: 2 },
];
assert.equal(boardConsensus.observe(flop, { handId: 8, now: 0 }).confirmedCount, 0);
assert.equal(boardConsensus.observe(flop, { handId: 8, now: 60 }).confirmedCount, 3, 'board suits also require temporal confirmation');

// Performance gate: this is a local detector and must stay cheap. A generous
// CI-safe budget catches accidental OCR/async/heavy-image work in the hot path.
const loops = 120;
const t0 = performance.now();
let calls = 0;
for (let n = 0; n < loops; n++) {
  for (const [expected, fixture] of fixtures) {
    const out = classifySuitPixels(fixture.data, fixture.w, fixture.h);
    assert.equal(out.suit, expected);
    calls++;
  }
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
assert.match(refinerRuntime, /machine\.setHero =/);
assert.match(refinerRuntime, /machine\.setBoard =/);
assert.match(refinerRuntime, /suitConfidence/);

console.log('SUIT READER V2 regressions passed');
