import assert from 'node:assert/strict';
import fs from 'node:fs';
import { observeStablePot } from '../src/core/stable-pot-consensus-r14.js';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const transaction = fs.readFileSync(new URL('../src/vision/state-transaction-runtime-r14.js', import.meta.url), 'utf8');
const boardRefiner = fs.readFileSync(new URL('../src/vision/board-refiner-runtime-r14.js', import.meta.url), 'utf8');

assert.match(bootstrap, /state-transaction-runtime-r14/);
assert.match(bootstrap, /board-refiner-runtime-r14/);
assert.match(bootstrap, /suit-scanner-runtime-r9/);
assert.match(bootstrap, /hero-authority-runtime-r11/);
assert.doesNotMatch(bootstrap, /replay-lifecycle-r8/);
assert.doesNotMatch(bootstrap, /card-refiner-runtime\.js/);

assert.match(transaction, /observePotValue = \(\) =>/);
assert.match(transaction, /MutationObserver/);
assert.match(transaction, /state\.hero = cloneCards\(stableHero\)/);
assert.match(transaction, /state\.board = cloneCards\(stableBoard\)/);
assert.doesNotMatch(boardRefiner, /newHand\s*\(/);
assert.doesNotMatch(boardRefiner, /quarantine/i);

const c = { value: null, pending: null, hits: 0 };
assert.equal(observeStablePot(c, 0.05), null);
assert.equal(observeStablePot(c, 0.05), null);
assert.equal(observeStablePot(c, 0.05), 0.05);
assert.equal(c.value, 0.05);

// A large OCR outlier must not replace a committed pot immediately.
assert.equal(observeStablePot(c, 4), null);
assert.equal(observeStablePot(c, 4), null);
assert.equal(observeStablePot(c, 4), 4);
assert.equal(c.value, 4);

// And a repeated lower reading can correct that bad OCR lock without rotating hand.
assert.equal(observeStablePot(c, 0.07), null);
assert.equal(observeStablePot(c, 0.07), null);
assert.equal(observeStablePot(c, 0.07), null);
assert.equal(observeStablePot(c, 0.07), 0.07);
assert.equal(c.value, 0.07);

console.log('STATE TRANSACTION R14 passed');
