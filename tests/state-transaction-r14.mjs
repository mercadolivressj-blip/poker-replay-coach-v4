import assert from 'node:assert/strict';
import fs from 'node:fs';
import { observeStablePot } from '../src/core/stable-pot-consensus-r14.js';
import { parseCards, parsePot } from '../src/vision/manual-controls-runtime-r14.js';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const transaction = fs.readFileSync(new URL('../src/vision/state-transaction-runtime-r14.js', import.meta.url), 'utf8');
const lifecycle = fs.readFileSync(new URL('../src/core/deal-lifecycle-r14.js', import.meta.url), 'utf8');
const boardRefiner = fs.readFileSync(new URL('../src/vision/board-refiner-runtime-r14.js', import.meta.url), 'utf8');
const recalibrate = fs.readFileSync(new URL('../src/vision/recalibrate-runtime-r14.js', import.meta.url), 'utf8');
const manualControls = fs.readFileSync(new URL('../src/vision/manual-controls-runtime-r14.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../r14.html', import.meta.url), 'utf8');

assert.match(bootstrap, /state-transaction-runtime-r14/);
assert.match(bootstrap, /manual-hero-authority-r14/);
assert.match(bootstrap, /board-refiner-runtime-r14/);
assert.match(bootstrap, /suit-scanner-runtime-r9/);
assert.doesNotMatch(bootstrap, /hero-authority-runtime-r11/);
assert.match(bootstrap, /recalibrate-runtime-r14/);
assert.match(bootstrap, /manual-controls-runtime-r14/);
assert.doesNotMatch(bootstrap, /replay-lifecycle-r8/);
assert.doesNotMatch(bootstrap, /card-refiner-runtime\.js/);

assert.match(transaction, /DealSnapshotArbiter/);
assert.match(transaction, /DealLifecycleR14/);
assert.match(transaction, /physical-redeal/);
assert.match(transaction, /requestReadingRecalibration/);
assert.match(transaction, /applyManualReplayState/);
assert.match(transaction, /automatic-refresh/);
assert.match(transaction, /manual-override/);
assert.match(transaction, /consumeManualRebind\(token, 'hero'/);
assert.match(transaction, /consumeManualRebind\(token, 'board'/);
assert.match(transaction, /observePotValue = \(\) =>/);
assert.match(transaction, /MutationObserver/);
assert.doesNotMatch(transaction, /stableHero\s*=/);
assert.doesNotMatch(transaction, /stableBoard\s*=/);
assert.doesNotMatch(transaction, /stablePot\s*=/);

assert.match(lifecycle, /heroGapArmed/);
assert.match(lifecycle, /boardClearArmed/);
assert.match(lifecycle, /heroReappearHits/);
assert.match(lifecycle, /physical-redeal/);

assert.doesNotMatch(boardRefiner, /newHand\s*\(/);
assert.doesNotMatch(boardRefiner, /quarantine/i);
assert.match(boardRefiner, /manualZeroHits >= 3/);
assert.match(boardRefiner, /rebindToken/);

assert.match(recalibrate, /Refresh leitura/);
assert.match(page, /id="recalibrateBtn"/);
assert.match(page, />↻ Refresh leitura</);
assert.doesNotMatch(page, /id="manualBtn"/);
assert.match(page, /data-manual-target="hero"/);
assert.match(page, /data-manual-target="board"/);
assert.match(page, /data-manual-target="pot"/);
assert.match(page, /id="manualCardSlots"/);
assert.match(page, /id="manualRankGrid"/);
assert.match(page, /id="manualSuitGrid"/);
assert.match(page, /data-board-count="0"/);
assert.match(page, /data-board-count="3"/);
assert.match(page, /data-board-count="4"/);
assert.match(page, /data-board-count="5"/);
assert.match(page, /id="manualPotInput"/);
assert.doesNotMatch(page, /id="manualHeroInput"/);
assert.doesNotMatch(page, /id="manualBoardInput"/);
assert.match(manualControls, /__prcApplyManualReplayStateR14/);
assert.match(manualControls, /RANKS/);
assert.match(manualControls, /SUIT_META/);
assert.match(manualControls, /renderCardEditor/);
assert.match(manualControls, /\.metric-editable\[data-manual-target\]/);
assert.match(manualControls, /Carta duplicada/);

const parsedHero = parseCards('J♥ 2♦', [2]);
assert.deepEqual(parsedHero.map(({ rank, suit }) => ({ rank, suit })), [
  { rank: 'J', suit: 'hearts' },
  { rank: '2', suit: 'diamonds' },
]);
assert.deepEqual(parseCards('Jh 2d', [2]).map(({ rank, suit }) => ({ rank, suit })), [
  { rank: 'J', suit: 'hearts' },
  { rank: '2', suit: 'diamonds' },
]);
assert.equal(parseCards('J♥', [2]), null);
assert.equal(parsePot('0,07'), 0.07);
assert.equal(parsePot('US$ 0,07'), 0.07);

const c = { value: null, pending: null, hits: 0 };
assert.equal(observeStablePot(c, 0.05), null);
assert.equal(observeStablePot(c, 0.05), null);
assert.equal(observeStablePot(c, 0.05), 0.05);
assert.equal(c.value, 0.05);

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
