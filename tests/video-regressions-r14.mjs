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

// VIDEO REGRESSION 5: manual-Hero, raw 2/2 and a trustworthy public board are
// mandatory. Board trust may come from stable physical occupancy OR exact fast
// board identity 2/2 when the local count-only detector lags.
const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const transaction = fs.readFileSync(new URL('../src/vision/state-transaction-runtime-r14.js', import.meta.url), 'utf8');
const heroContinuity = fs.readFileSync(new URL('../src/vision/hero-continuity-guard-r14.js', import.meta.url), 'utf8');
const lifecycleSource = fs.readFileSync(new URL('../src/core/deal-lifecycle-r14.js', import.meta.url), 'utf8');
const safety = fs.readFileSync(new URL('../src/solver/study-safety-gate-r14.js', import.meta.url), 'utf8');
const decisionStore = fs.readFileSync(new URL('../src/core/decision-store.js', import.meta.url), 'utf8');
assert.doesNotMatch(bootstrap, /hero-authority-runtime-r11/);
assert.match(transaction, /DealLifecycleR14/);
assert.match(transaction, /lifecycle\.observeHero\(Boolean\(present\), now\)/);
assert.match(transaction, /if \(observed\.newDeal\)/);
assert.match(transaction, /diagnostics\.physicalRedeals\+\+/);
assert.match(transaction, /machine\.newHand\(reason, now\)/);
assert.match(lifecycleSource, /physical-redeal/);
assert.match(safety, /rawStableFrames >= 2/);
assert.match(safety, /fastIdentityConsensus/);
assert.match(safety, /visualBoardCount/);
assert.match(decisionStore, /strategicDeadlineFallback: false/);
assert.match(decisionStore, /clockStartsAfterManualHero: true/);

// VIDEO REGRESSION 6: postflop board clear is now DEFERRED instead of rotating
// instantly. This prevents brief zero-board frames during flop->turn / turn->river
// animation from deleting the manual Hero and pot. If board remains truly empty
// beyond the grace window, the old hand still rotates and cannot leak forward.
assert.match(transaction, /BOARD_CLEAR_GRACE_MS = 500/);
assert.match(transaction, /pendingBoardClear/);
assert.match(transaction, /deferredBoardClears/);
assert.match(transaction, /suppressedBoardClears/);
assert.match(transaction, /r14-board-clear-pending-grace/);
assert.match(transaction, /r14-board-clear-cancelled-street-continues/);
assert.match(transaction, /now - pendingBoardClear\.armedAt < BOARD_CLEAR_GRACE_MS/);
assert.match(transaction, /r14-board-cleared-postflop/);

// VIDEO REGRESSION 7: PokerStars may briefly hide/move Hero cards while dealing
// the flop. A preflop Hero gap therefore cannot rotate immediately. The R14
// transaction layer must defer it for one cycle and cancel the pending redeal
// as soon as a live flop/turn/river board is observed.
assert.match(transaction, /pendingHeroRedeal/);
assert.match(transaction, /deferredHeroRedeals/);
assert.match(transaction, /suppressedHeroRedeals/);
assert.match(transaction, /r14-hero-redeal-pending-board-check/);
assert.match(transaction, /r14-hero-redeal-suppressed-board-live/);
assert.match(transaction, /count > 0 && pendingHeroRedeal/);
assert.match(transaction, /Number\(lifecycle\.visualBoardCount\) > 0/);

// VIDEO REGRESSION 8: once there is a logical postflop board, Hero disappearance
// alone is never allowed to rotate the deal. Board continuity owns the boundary,
// so the manually entered Hero survives flop->turn->river.
assert.match(transaction, /logicalBoardCount > 0/);
assert.match(transaction, /r14-hero-redeal-suppressed-postflop/);
assert.match(transaction, /count >= previousCount/);
assert.match(transaction, /r14-board-redeal-after-clear/);

// VIDEO REGRESSION 9: the observed real replay can keep Hero cards physically
// visible while the board detector reads zero for >500ms during turn->river.
// A board-only boundary must therefore be vetoed while physical Hero was seen
// recently; otherwise generation change deletes the manual Hero mid-hand.
assert.match(bootstrap, /hero-continuity-guard-r14/);
assert.match(heroContinuity, /HERO_RECENT_MS = 1000/);
assert.match(heroContinuity, /r14-board-cleared-postflop/);
assert.match(heroContinuity, /r14-board-redeal-after-clear/);
assert.match(heroContinuity, /heroRecentlyPhysical/);
assert.match(heroContinuity, /postflopAlive/);
assert.match(heroContinuity, /machine\.handId === beforeHandId/);
assert.match(heroContinuity, /r14-hero-continuity-protected/);

// VIDEO REGRESSION 10: physical Hero disappearance/reappearance alone is NEVER
// sufficient to clear a manually-entered Hero. A pending preflop boundary must
// wait for public redeal evidence: dealer/button movement or a stable pot reset.
// Any visible board cancels the pending boundary and proves the same hand lives.
assert.match(heroContinuity, /PREFLOP_REDEAL_GRACE_MS = 250/);
assert.match(heroContinuity, /PREFLOP_HERO_REDEAL_REASON = 'r14-physical-hero-redeal'/);
assert.match(heroContinuity, /pendingPreflopHeroBoundary/);
assert.match(heroContinuity, /preflopBoundaryPending/);
assert.match(heroContinuity, /lastStableDealerSeat/);
assert.match(heroContinuity, /lastStablePublicPot/);
assert.match(heroContinuity, /function redealEvidence/);
assert.match(heroContinuity, /dealerChanged \|\| potReset/);
assert.match(heroContinuity, /preflop-hero-boundary-awaiting-public-evidence/);
assert.match(heroContinuity, /r14-preflop-redeal-awaiting-public-boundary/);
assert.match(heroContinuity, /preflop-hero-boundary-confirmed-dealer-moved/);
assert.match(heroContinuity, /preflop-hero-boundary-confirmed-pot-reset/);
assert.match(heroContinuity, /anyPublicBoardVisible/);
assert.match(safety, /boundaryPending/);
assert.match(safety, /public-redeal-evidence/);

console.log('VIDEO REGRESSIONS R14 passed');
