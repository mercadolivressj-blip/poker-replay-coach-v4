import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifySuitMask, SUIT_MASK_W, SUIT_MASK_H } from '../src/core/suit-classifier.js';

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
