import assert from 'node:assert/strict';
import fs from 'node:fs';
import { observeStablePot } from '../src/core/stable-pot-consensus-r14.js';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const transaction = fs.readFileSync(new URL('../src/vision/state-transaction-runtime-r14.js', import.meta.url), 'utf8');
const boardRefiner = fs.readFileSync(new URL('../src/vision/board-refiner-runtime-r14.js', import.meta.url), 'utf8');
const heroAuthority = fs.readFileSync(new URL('../src/vision/hero-authority-runtime-r11.js', import.meta.url), 'utf8');
const recalibrate = fs.readFileSync(new URL('../src/vision/recalibrate-runtime-r14.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../r14.html', import.meta.url), 'utf8');

assert.match(bootstrap, /state-transaction-runtime-r14/);
assert.match(bootstrap, /board-refiner-runtime-r14/);
assert.match(bootstrap, /suit-scanner-runtime-r9/);
assert.match(bootstrap, /hero-authority-runtime-r11/);
assert.match(bootstrap, /recalibrate-runtime-r14/);
assert.doesNotMatch(bootstrap, /replay-lifecycle-r8/);
assert.doesNotMatch(bootstrap, /card-refiner-runtime\.js/);

assert.match(transaction, /DealSnapshotArbiter/);
assert.match(transaction, /requestReadingRecalibration/);
assert.match(transaction, /prc:recalibrate/);
assert.match(transaction, /observePotValue = \(\) =>/);
assert.match(transaction, /MutationObserver/);
assert.doesNotMatch(transaction, /stableHero\s*=/);
assert.doesNotMatch(transaction, /stableBoard\s*=/);
assert.doesNotMatch(transaction, /stablePot\s*=/);

assert.doesNotMatch(heroAuthority, /hero-authority-visual-change-r12/);
assert.match(heroAuthority, /hero-authority-physical-redeal-r14/);
assert.match(heroAuthority, /manualRebindToken/);
assert.doesNotMatch(heroAuthority, /machine\.state\.hero\s*=/);

assert.doesNotMatch(boardRefiner, /newHand\s*\(/);
assert.doesNotMatch(boardRefiner, /quarantine/i);
assert.match(boardRefiner, /manualZeroHits >= 3/);
assert.match(boardRefiner, /rebindToken/);

assert.match(recalibrate, /Recalibrar leitura/);
assert.match(page, /id="recalibrateBtn"/);
assert.match(page, />Recalibrar leitura</);

const c = { value: null, pending: null, hits: 0 };
assert.equal(observeStablePot(c, 0.05), null);
assert.equal(observeStablePot(c, 0.05), null);
assert.equal(observeStablePot(c, 0.05), 0.05);
assert.equal(c.value, 0.05);

// Keep the existing R14 temporal pot behavior untouched in this card-generation change.
assert.equal(observeStablePot(c, 4), null);
assert.equal(observeStablePot(c, 4), null);
assert.equal(observeStablePot(c, 4), 4);
assert.equal(c.value, 4);
assert.equal(observeStablePot(c, 0.07), null);
assert.equal(observeStablePot(c, 0.07), null);
assert.equal(observeStablePot(c, 0.07), null);
assert.equal(observeStablePot(c, 0.07), 0.07);
assert.equal(c.value, 0.07);

console.log('STATE TRANSACTION R14 passed');
