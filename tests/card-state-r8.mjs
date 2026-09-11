import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HeroCardConsensus } from '../src/core/hero-card-consensus.js';

// The legacy fast reader may hint forever, but R8 never lets it become the
// authoritative Hero hand without a trusted refiner/OCR contribution.
const c = new HeroCardConsensus({ windowMs: 600, strongConfidence: 0.76 });
c.resetHand(8);
const wrongFast = [
  { rank: 'A', confidence: 0.97, source: 'seeded-template' },
  { rank: 'T', confidence: 0.97, source: 'seeded-template' },
];
for (let i = 0; i < 7; i++) {
  const out = c.observe(wrongFast, { handId: 8, now: i * 55, source: 'fast' });
  assert.equal(out.accepted, false, 'fast-only evidence must never lock the Hero hand');
  assert.equal(c.snapshot().committed, null);
}

const correct = [
  { rank: 'A', suit: 'spades', confidence: 0.94, source: 'hero-rank-refiner' },
  { rank: '8', suit: 'clubs', confidence: 0.94, source: 'hero-rank-refiner' },
];
assert.equal(c.observe(correct, { handId: 8, now: 410, source: 'refiner' }).accepted, false);
assert.equal(c.observe(correct, { handId: 8, now: 465, source: 'refiner' }).accepted, false);
const committed = c.observe(correct, { handId: 8, now: 520, source: 'refiner' });
assert.equal(committed.accepted, true, 'three trusted refiner reads must beat stale/incorrect fast hints');
assert.equal(committed.key, 'A8');
assert.equal(c.snapshot().committed.authority, 'refiner');

const refiner = fs.readFileSync(new URL('../src/vision/card-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(refiner, /function dedicatedHeroRankSlots/);
assert.match(refiner, /heroRankGeometry: 'dedicated-r8'/);
assert.match(refiner, /allowCandidates: true, candidateMinHits: 3/);
assert.match(refiner, /visual-redeal-r8/);
assert.match(refiner, /quarantineCards/);
assert.match(refiner, /rank === 'T' && second === '8'/);
assert.match(refiner, /rank === '8' && second === 'T'/);
assert.match(refiner, /cardPresenceScore\(c\.data, c\.w, c\.h\)/);

const lifecycle = fs.readFileSync(new URL('../src/vision/replay-lifecycle-r8.js', import.meta.url), 'utf8');
assert.match(lifecycle, /redeal-confirming-r8/);
assert.match(lifecycle, /hero-redeal-r8/);
assert.match(lifecycle, /quarantine\(machine\)/);

console.log('CARD STATE R8 regressions passed');
