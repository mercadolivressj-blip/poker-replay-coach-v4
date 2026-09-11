import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PotConsensus } from '../src/detectors/pot.js';

const pot = new PotConsensus();
assert.equal(pot.observe(2362), null, 'first pot read stays pending');
assert.equal(pot.observe(2362), 2362, 'two agreeing reads confirm the pot');
assert.equal(pot.observe(4724), null, 'larger pot requires temporal confirmation');
assert.equal(pot.observe(4724), 4724, 'two agreeing larger reads replace stale pot');
assert.equal(pot.observe(2362), null, 'same-hand pot cannot regress materially');

// Keep the refiner implementation testable, but do not auto-start it in replay:
// a second independent Tesseract/OCR loop caused browser main-thread starvation.
const potRuntime = fs.readFileSync(new URL('../src/vision/pot-refiner-runtime.js', import.meta.url), 'utf8');
assert.match(potRuntime, /findPotPill/);
assert.match(potRuntime, /potCrop\(zone\.canvas, null\)/, 'whole-zone OCR fallback must remain available for future shared-OCR refactor');
assert.match(potRuntime, /consensus\.observe/);
assert.match(potRuntime, /machine\.setPot/);
assert.match(potRuntime, /__prcPotRefinerDiagnostics/);

const bridge = fs.readFileSync(new URL('../src/coach/local-ui-bridge.js', import.meta.url), 'utf8');
assert.match(bridge, /heroToAct/);
assert.match(bridge, /confidence\.textContent = '—'/, 'confidence must clear outside hero turn');

const bootstrap = fs.readFileSync(new URL('../src/bootstrap.js', import.meta.url), 'utf8');
assert.doesNotMatch(bootstrap, /pot-refiner-runtime\.js/, 'duplicate pot OCR must stay off the replay runtime hot path');

console.log('POT REFINER V2 regressions passed');
