import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DealLifecycleR14 } from '../src/core/deal-lifecycle-r14.js';
import { DealSnapshotArbiter } from '../src/core/deal-snapshot-arbiter-r14.js';

const card = (rank, suit) => ({ rank, suit, confidence: 1 });

// VIDEO REGRESSION 1: an old river must die when physical Hero cards disappear
// long enough and then reappear for the next deal. Board clear is independent
// confirmation, so the first stable reappearance can rotate the generation.
const life = new DealLifecycleR14({ heroMissingHits: 4, heroMissingMs: 260, heroReappearHits: 2, boardZeroHits: 3, boardZeroMs: 120 });
life.reset(7, 0);
life.seedHeroPresence(true, 100);
life.observeBoardCount(5, 200);
life.observeBoardCount(5, 260);
life.observeBoardCount(5, 320);
life.observeHero(false, 1000);
life.observeBoardCount(0, 1000);
life.observeHero(false, 1100);
life.observeBoardCount(0, 1100);
life.observeHero(false, 1200);
life.observeBoardCount(0, 1200);
let boundary = life.observeHero(false, 1300);
assert.equal(boundary.newDeal, false);
assert.equal(life.heroGapArmed, true, 'sustained physical Hero gap must arm a redeal');
assert.equal(life.boardClearArmed, true, 'stable old-board -> zero must arm public-state invalidation');
boundary = life.observeHero(true, 1350);
assert.equal(boundary.newDeal, true, 'Hero reappearance after a real gap must start a new generation');
assert.match(boundary.reason, /redeal/);

// VIDEO REGRESSION 2: a short capture glitch inside one hand must NOT erase the
// manually-entered Hero cards or rotate the generation.
const transient = new DealLifecycleR14({ heroMissingHits: 4, heroMissingMs: 260 });
transient.reset(8, 0);
transient.seedHeroPresence(true, 100);
assert.equal(transient.observeHero(false, 500).newDeal, false);
assert.equal(transient.observeHero(false, 580).newDeal, false);
assert.equal(transient.observeHero(true, 650).newDeal, false);
assert.equal(transient.heroGapArmed, false);

// VIDEO REGRESSION 3: late/stale pot reads may not move the pot backwards inside
// the same deal. A manual correction is the only allowed same-generation decrease.
const machine = {
  handId: 11,
  state: { hero: [], board: [], pot: null, street: 'preflop' },
};
const arbiter = new DealSnapshotArbiter(machine);
assert.equal(arbiter.commitPot(0.08, { generation: 11, source: 'ai-decision', now: 10 }).accepted, true);
let pot = arbiter.commitPot(0.03, { generation: 11, source: 'ai-full-frame', now: 20 });
assert.equal(pot.accepted, false, '0.08 -> 0.03 stale regression must be blocked');
assert.equal(pot.reason, 'pot-regression-lock');
assert.equal(machine.state.pot, 0.08);
assert.equal(arbiter.diagnostics.potRegressionBlocks, 1);
assert.equal(arbiter.commitPot(0.03, { generation: 11, source: 'manual', now: 30 }).accepted, true);
assert.equal(machine.state.pot, 0.03);

// VIDEO REGRESSION 4: generation change atomically blanks every strategic public
// field, so a river from hand N can never be the starting board of hand N+1.
assert.equal(arbiter.commitHero([card('7','diamonds'), card('3','clubs')], { generation: 11, now: 40 }).accepted, true);
assert.equal(arbiter.commitBoard([
  card('K','clubs'), card('4','hearts'), card('K','spades'), card('3','hearts'), card('8','clubs'),
], { generation: 11, now: 50 }).accepted, true);
machine.handId = 12;
assert.equal(arbiter.syncGeneration(60), true);
const fresh = arbiter.view();
assert.deepEqual(fresh.hero, []);
assert.deepEqual(fresh.board, []);
assert.equal(fresh.pot, null);
assert.equal(fresh.street, 'preflop');

// VIDEO REGRESSION 5: R14 manual-Hero build must not load the legacy automatic
// Hero authority, and normal strategy requires raw 2/2 plus physical board match.
const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const transaction = fs.readFileSync(new URL('../src/vision/state-transaction-runtime-r14.js', import.meta.url), 'utf8');
const safety = fs.readFileSync(new URL('../src/solver/study-safety-gate-r14.js', import.meta.url), 'utf8');
assert.doesNotMatch(bootstrap, /hero-authority-runtime-r11/);
assert.match(transaction, /DealLifecycleR14/);
assert.match(transaction, /physical-redeal/);
assert.match(safety, /rawStableFrames >= 2/);
assert.match(safety, /physical-board-match/);
assert.match(safety, /visualBoardCount/);

console.log('VIDEO REGRESSIONS R14 passed');
