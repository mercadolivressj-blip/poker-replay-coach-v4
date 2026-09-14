import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DealLifecycleR14 } from '../src/core/deal-lifecycle-r14.js';
import { DealSnapshotArbiter } from '../src/core/deal-snapshot-arbiter-r14.js';

const card = (rank, suit) => ({ rank, suit, confidence: 1 });

// VIDEO REGRESSION 1: low-level lifecycle may flag a physical redeal candidate.
// R14's continuity guard owns the final generation decision and requires public
// dealer proof before a locked Hero can actually be cleared.
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
assert.equal(life.heroGapArmed, true, 'sustained physical Hero gap must arm a redeal candidate');
assert.equal(life.boardClearArmed, true, 'stable old-board -> zero must arm a public boundary candidate');
boundary = life.observeHero(true, 1350);
assert.equal(boundary.newDeal, true, 'low-level lifecycle may emit a redeal candidate on reappearance');
assert.match(boundary.reason, /redeal/);

// VIDEO REGRESSION 2: a short capture glitch inside one hand must NOT erase the
// confirmed Hero cards or rotate the generation.
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

// VIDEO REGRESSION 5: old public-state safety modules still keep their strict
// contracts even though R14's fundamental decision core no longer waits for the
// old 2/2 gate to be the only strategy path.
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
assert.match(decisionStore, /clockStartsAfterHeroConfirmation: true/);

// VIDEO REGRESSION 6: lower transaction layer still defers board clears rather
// than rotating instantly. The continuity guard above it now adds dealer proof.
assert.match(transaction, /BOARD_CLEAR_GRACE_MS = 500/);
assert.match(transaction, /pendingBoardClear/);
assert.match(transaction, /deferredBoardClears/);
assert.match(transaction, /suppressedBoardClears/);
assert.match(transaction, /r14-board-clear-pending-grace/);
assert.match(transaction, /r14-board-clear-cancelled-street-continues/);
assert.match(transaction, /now - pendingBoardClear\.armedAt < BOARD_CLEAR_GRACE_MS/);
assert.match(transaction, /r14-board-cleared-postflop/);

// VIDEO REGRESSION 7: PokerStars may briefly hide/move Hero cards while dealing
// the flop. A preflop Hero gap therefore cannot rotate immediately.
assert.match(transaction, /pendingHeroRedeal/);
assert.match(transaction, /deferredHeroRedeals/);
assert.match(transaction, /suppressedHeroRedeals/);
assert.match(transaction, /r14-hero-redeal-pending-board-check/);
assert.match(transaction, /r14-hero-redeal-suppressed-board-live/);
assert.match(transaction, /count > 0 && pendingHeroRedeal/);
assert.match(transaction, /Number\(lifecycle\.visualBoardCount\) > 0/);

// VIDEO REGRESSION 8: once there is a logical postflop board, Hero disappearance
// alone is never allowed to rotate the deal. Board continuity owns the candidate.
assert.match(transaction, /logicalBoardCount > 0/);
assert.match(transaction, /r14-hero-redeal-suppressed-postflop/);
assert.match(transaction, /count >= previousCount/);
assert.match(transaction, /r14-board-redeal-after-clear/);

// VIDEO REGRESSION 9: the observed real replay can keep Hero cards physically
// visible while the board detector reads zero during a street animation. The
// central guard must preserve the generation until public boundary proof exists.
assert.match(bootstrap, /hero-continuity-guard-r14/);
assert.match(heroContinuity, /HERO_RECENT_MS = 1000/);
assert.match(heroContinuity, /r14-board-cleared-postflop/);
assert.match(heroContinuity, /r14-board-redeal-after-clear/);
assert.match(heroContinuity, /heroRecentlyPhysical/);
assert.match(heroContinuity, /authorityLocked/);
assert.match(heroContinuity, /machine\.handId === beforeHandId/);
assert.match(heroContinuity, /r14-hero-continuity-protected/);

// VIDEO REGRESSION 10: once Hero is locked, card disappearance, board clear and
// pot reset are NEVER sufficient to erase it. The dealer/button must move and the
// SAME new dealer must be observed twice. Pot reset remains diagnostic only.
assert.match(heroContinuity, /PREFLOP_REDEAL_GRACE_MS = 250/);
assert.match(heroContinuity, /DEALER_CONFIRM_HITS = 2/);
assert.match(heroContinuity, /PREFLOP_HERO_REDEAL_REASON = 'r14-physical-hero-redeal'/);
assert.match(heroContinuity, /pendingPreflopHeroBoundary/);
assert.match(heroContinuity, /pendingBoardBoundary/);
assert.match(heroContinuity, /preflopBoundaryPending/);
assert.match(heroContinuity, /boardBoundaryPending/);
assert.match(heroContinuity, /lastStableDealerSeat/);
assert.match(heroContinuity, /function dealerProof/);
assert.match(heroContinuity, /dealerChanged && pending\.dealerHits >= DEALER_CONFIRM_HITS/);
assert.match(heroContinuity, /potResetAccepted: false/);
assert.match(heroContinuity, /blockedPotOnlyBoundaries/);
assert.match(heroContinuity, /preflop-hero-boundary-awaiting-stable-dealer-move/);
assert.match(heroContinuity, /board-boundary-awaiting-stable-dealer-move/);
assert.match(heroContinuity, /preflop-hero-boundary-confirmed-dealer-moved-2of2/);
assert.match(heroContinuity, /board-boundary-confirmed-dealer-moved-2of2/);
assert.match(heroContinuity, /physicalBoardVisible/);
assert.match(safety, /boundaryPending/);
assert.match(safety, /public-redeal-evidence/);

console.log('VIDEO REGRESSIONS R14 passed');
