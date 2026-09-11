import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifySuitMask, classifySuitPixels, SUIT_MASK_W, SUIT_MASK_H } from '../src/core/suit-classifier.js';

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
  // Deliberately draw a large fake rank on the left. The suit reader must not
  // select this component; this is the regression for the real PokerStars bug.
  for (let y = card.y + 5; y < card.y + 27; y++) for (let x = card.x + 4; x < card.x + 18; x++) {
    if (x === card.x + 4 || x === card.x + 17 || y === card.y + 5 || y === card.y + 26) {
      const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 22;
    }
  }
  const rgb = family === 'red' ? [205, 28, 34] : [24, 24, 24];
  const drawMask = (ox) => {
    const size = 19;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const sx = Math.min(SUIT_MASK_W - 1, Math.floor(dx * SUIT_MASK_W / size));
      const sy = Math.min(SUIT_MASK_H - 1, Math.floor(dy * SUIT_MASK_H / size));
      if (!mask[sy * SUIT_MASK_W + sx]) continue;
      const x = ox + dx, y = card.y + 5 + dy; const i = (y * w + x) * 4;
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
  };
  drawMask(card.x + 31); // first suit glyph
  drawMask(card.x + 57); // repeated right-hand suit glyph
  return { data, w, h };
}

for (const [suit, [family, b64]] of Object.entries(samples)) {
  const fixture = paintSyntheticPokerStarsCard(unpack(b64), family);
  const out = classifySuitPixels(fixture.data, fixture.w, fixture.h);
  assert.equal(out.suit, suit, `${suit} must be extracted from the suit region, not the rank region`);
  assert(['right-suit', 'mid-suit'].includes(out.roi), `${suit} must report a suit ROI`);
}

const resolverRuntime = fs.readFileSync(new URL('../src/solver/resolver-runtime.js', import.meta.url), 'utf8');
assert.match(resolverRuntime, /completeCard/);
assert.match(resolverRuntime, /LENDO NAIPE/);
assert.match(resolverRuntime, /publishDecision/);
assert.match(resolverRuntime, /MutationObserver/);
assert.match(resolverRuntime, /source: 'resolver-local'/);

const refinerRuntime = fs.readFileSync(new URL('../src/vision/card-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(refinerRuntime, /HeroCardConsensus/);
assert.match(refinerRuntime, /classifySuitPixels/);
assert.match(refinerRuntime, /machine\.setHero =/);
assert.match(refinerRuntime, /suitConfidence/);

console.log('SUIT READER V1 regressions passed');
