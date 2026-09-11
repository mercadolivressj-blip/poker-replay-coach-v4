import assert from 'node:assert/strict';
import fs from 'node:fs';
import { layoutFromFelt } from '../src/core/geometry.js';

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

const runtime = fs.readFileSync(new URL('../src/vision/card-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(runtime, /layout\.heroSuitSlots \|\| layout\.heroSlots/, 'Hero refiner must consume dedicated suit geometry');
assert.match(runtime, /function classifyHeroCard/, 'Hero suit refinement must have its own classifier path');
assert.match(runtime, /confirmedRank/, 'Hero suit refinement must preserve the already-confirmed rank');
assert.match(runtime, /classifySuitPixels\(crop\.data, crop\.w, crop\.h, confirmedRank\)/, 'Hero refiner must classify suit using the confirmed rank');
assert.match(runtime, /const boardCrops = layout\.boardSlots/, 'board path must remain unchanged');

console.log('HERO SUIT READER V1 regressions passed');
