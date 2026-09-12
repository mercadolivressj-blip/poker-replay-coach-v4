import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DealLifecycleR14 } from '../src/core/deal-lifecycle-r14.js';
import { DealSnapshotArbiter } from '../src/core/deal-snapshot-arbiter-r14.js';

const card = (rank, suit) => ({ rank, suit, confidence: 1, source: 'video-shadow' });
const hero = (a, sa, b, sb) => [card(a, sa), card(b, sb)];
const board = (...spec) => spec.map(([r,s]) => card(r,s));

const machine = {
  handId: 0,
  state: null,
  blank() { return { hero: [], board: [], street: 'preflop', pot: null, actions: [], heroToAct: false }; },
};
machine.state = machine.blank();

const life = new DealLifecycleR14({ heroMissingHits: 4, heroMissingMs: 260, heroReappearHits: 2, boardZeroHits: 3, boardZeroMs: 120 });
const arbiter = new DealSnapshotArbiter(machine);
let now = 0;
let previousBoardCount = 0;

function beginFirstHand(cards, label) {
  machine.handId = 1;
  machine.state = machine.blank();
  arbiter.syncGeneration(now);
  life.reset(machine.handId, now);
  life.seedHeroPresence(true, now + 10);
  assert.equal(arbiter.commitHero(cards, { generation: machine.handId, now: now + 20 }).accepted, true, `${label}: manual Hero must bind`);
  previousBoardCount = 0;
}

function physicalRedeal(cards, label, { staleBoard = null, stalePot = null } = {}) {
  const oldGeneration = machine.handId;
  const oldHero = machine.state.hero.map((c) => ({ ...c }));
  const oldBoard = machine.state.board.map((c) => ({ ...c }));

  // The recording shows a real card/deal gap between physical hands. Four misses
  // over >260 ms arm the boundary. When a board existed, its physical disappearance
  // independently arms public-state invalidation.
  const t0 = now + 100;
  life.observeHero(false, t0);
  if (previousBoardCount > 0) life.observeBoardCount(0, t0);
  life.observeHero(false, t0 + 100);
  if (previousBoardCount > 0) life.observeBoardCount(0, t0 + 100);
  life.observeHero(false, t0 + 200);
  if (previousBoardCount > 0) life.observeBoardCount(0, t0 + 200);
  life.observeHero(false, t0 + 320);
  if (previousBoardCount > 0) life.observeBoardCount(0, t0 + 320);
  assert.equal(life.heroGapArmed, true, `${label}: physical Hero gap must arm redeal`);

  let redeal = life.observeHero(true, t0 + 380);
  if (!redeal.newDeal) redeal = life.observeHero(true, t0 + 440);
  assert.equal(redeal.newDeal, true, `${label}: physical reappearance must rotate generation`);

  machine.handId++;
  machine.state = machine.blank();
  assert.equal(arbiter.syncGeneration(t0 + 450), true, `${label}: arbiter must rotate atomically`);
  life.reset(machine.handId, t0 + 450);
  life.seedHeroPresence(true, t0 + 460);

  const fresh = arbiter.view();
  assert.deepEqual(fresh.hero, [], `${label}: old manual Hero must not leak to new hand`);
  assert.deepEqual(fresh.board, [], `${label}: old board must not leak to new hand`);
  assert.equal(fresh.pot, null, `${label}: old pot must not leak to new hand`);
  assert.equal(fresh.street, 'preflop', `${label}: new hand must start preflop`);

  // Simulate delayed packets from the previous hand: they must be rejected even
  // if they arrive after the new cards are physically visible.
  const delayedBoard = staleBoard || oldBoard;
  if (delayedBoard.length) {
    const stale = arbiter.commitBoard(delayedBoard, { generation: oldGeneration, now: t0 + 470 });
    assert.equal(stale.accepted, false, `${label}: stale board response from old hand must be rejected`);
  }
  if (Number.isFinite(stalePot)) {
    const stale = arbiter.commitPot(stalePot, { generation: oldGeneration, source: 'ai-full-frame', now: t0 + 475 });
    assert.equal(stale.accepted, false, `${label}: stale pot response from old hand must be rejected`);
  }

  assert.equal(arbiter.commitHero(cards, { generation: machine.handId, now: t0 + 480 }).accepted, true, `${label}: new manual Hero must bind`);
  assert.notDeepEqual(machine.state.hero, oldHero, `${label}: new manual Hero must replace prior hand`);
  previousBoardCount = 0;
  now = t0 + 500;
}

function setPot(value, label) {
  const out = arbiter.commitPot(value, { generation: machine.handId, source: 'ai-decision', now: now += 30 });
  assert.equal(out.accepted, true, `${label}: pot ${value} must be accepted`);
}

function attemptPotRegression(value, label) {
  const before = machine.state.pot;
  const out = arbiter.commitPot(value, { generation: machine.handId, source: 'ai-full-frame', now: now += 30 });
  assert.equal(out.accepted, false, `${label}: late smaller pot must be blocked`);
  assert.equal(machine.state.pot, before, `${label}: authoritative pot must not regress`);
}

function setBoard(cards, label, { rebind = false } = {}) {
  let options = { generation: machine.handId, now: now += 40 };
  if (rebind) {
    const token = arbiter.beginManualRecalibration(now);
    options = { ...options, rebindToken: token, forceRebind: true };
  }
  const out = arbiter.commitBoard(cards, options);
  assert.equal(out.accepted, true, `${label}: board ${cards.length} must commit`);
  life.observeBoardCount(cards.length, now);
  life.observeBoardCount(cards.length, now + 50);
  life.observeBoardCount(cards.length, now + 100);
  previousBoardCount = cards.length;
  assert.equal(machine.state.board.length, cards.length, `${label}: logical board count must follow physical board`);
  assert.equal(machine.state.hero.length, 2, `${label}: manual Hero must survive street changes`);
}

// Shadow trace reconstructed from the 13-minute recording. The exact strategy is
// intentionally NOT replayed here; this suite reproduces state movements that were
// poisoning strategy: streets, physical redeals, manual Hero, stale packets and pot.
beginFirstHand(hero('2','clubs','5','hearts'), '00:30 first deal');
setPot(0.03, '00:30 preflop');
setBoard(board(['2','hearts'],['7','diamonds'],['T','clubs']), '00:50 flop');
setPot(0.12, '00:50 flop pot');
setBoard(board(['2','hearts'],['7','diamonds'],['T','clubs'],['4','spades']), '01:00 turn');
setPot(0.21, '01:00 turn pot');

physicalRedeal(hero('K','hearts','3','clubs'), '01:20 K3 new hand', { stalePot: 0.21 });
setPot(0.05, '01:20 K3 preflop');
setBoard(board(['A','diamonds'],['4','clubs'],['9','spades']), '02:00 K3 flop');
setBoard(board(['A','diamonds'],['4','clubs'],['9','spades'],['6','hearts']), '02:10 K3 turn');
setBoard(board(['A','diamonds'],['4','clubs'],['9','spades'],['6','hearts'],['T','spades']), '02:20 K3 river');

physicalRedeal(hero('T','hearts','9','hearts'), '02:50 T9 new hand');
setPot(0.05, '02:50 T9 preflop');
setPot(0.13, '03:00 T9 raised pot');
attemptPotRegression(0.05, '03:00 stale full-frame pot');
setBoard(board(['5','hearts'],['7','diamonds'],['9','clubs']), '03:35 T9 flop');
setBoard(board(['5','hearts'],['7','diamonds'],['9','clubs'],['8','spades']), '03:37 T9 turn');
setBoard(board(['5','hearts'],['7','diamonds'],['9','clubs'],['8','spades'],['7','clubs']), '03:40 T9 river');

physicalRedeal(hero('7','diamonds','9','clubs'), '04:00 79 new hand');
setPot(0.03, '04:00 79 preflop');
setPot(0.26, '04:00 79 facing action');
attemptPotRegression(0.03, '04:00 stale pot packet');

physicalRedeal(hero('A','hearts','4','spades'), '04:30 A4 new hand');
setPot(0.03, '04:30 A4 preflop');
setBoard(board(['T','diamonds'],['K','clubs'],['7','clubs']), '04:40 A4 flop');
setBoard(board(['T','diamonds'],['K','clubs'],['7','clubs'],['A','diamonds']), '04:50 A4 turn');
setBoard(board(['T','diamonds'],['K','clubs'],['7','clubs'],['A','diamonds'],['4','spades']), '05:00 A4 river');

physicalRedeal(hero('Q','clubs','T','diamonds'), '05:20 QT new hand', { stalePot: 0.11 });
setPot(0.03, '05:20 QT preflop');
setBoard(board(['7','spades'],['K','diamonds'],['A','clubs']), '05:30 QT flop');
setBoard(board(['7','spades'],['K','diamonds'],['A','clubs'],['4','clubs']), '05:40 QT turn');
setBoard(board(['7','spades'],['K','diamonds'],['A','clubs'],['4','clubs'],['4','spades']), '05:50 QT river');

physicalRedeal(hero('Q','clubs','7','hearts'), '06:10 Q7 new hand');
setPot(0.07, '06:10 Q7 flop pot');
setBoard(board(['9','diamonds'],['4','hearts'],['6','diamonds']), '06:10 Q7 flop');
setBoard(board(['9','diamonds'],['4','hearts'],['6','diamonds'],['7','clubs']), '06:20 Q7 turn');
setBoard(board(['9','diamonds'],['4','hearts'],['6','diamonds'],['7','clubs'],['3','spades']), '06:30 Q7 river');
setPot(0.14, '06:40 Q7 river action');

physicalRedeal(hero('J','hearts','5','clubs'), '07:10 J5 new hand');
setPot(0.14, '07:10 J5 preflop');

physicalRedeal(hero('K','clubs','9','hearts'), '07:50 K9 new hand');
setPot(0.08, '07:50 K9 preflop');
setBoard(board(['5','spades'],['A','diamonds'],['2','hearts']), '08:00 K9 flop');
setBoard(board(['5','spades'],['A','diamonds'],['2','hearts'],['9','spades']), '08:10 K9 turn');
setBoard(board(['5','spades'],['A','diamonds'],['2','hearts'],['9','spades'],['8','diamonds']), '08:20 K9 river');

physicalRedeal(hero('6','clubs','5','clubs'), '08:50 65 new hand');
setPot(0.03, '08:50 65 preflop');

// Critical video failure reproduced exactly: old 9♠ T♣ 3♣ cannot survive into
// the 8♠8♥ deal, and the new 7♦2♥6♠ flop must replace it.
setBoard(board(['9','spades'],['T','clubs'],['3','clubs']), '09:20 prior-hand flop');
const priorGen = machine.handId;
physicalRedeal(hero('8','spades','8','hearts'), '09:40 88 new hand', {
  staleBoard: board(['9','spades'],['T','clubs'],['3','clubs']),
  stalePot: 0.15,
});
assert.ok(machine.handId > priorGen, '09:40: generation must advance');
assert.deepEqual(machine.state.board, [], '09:40: Coach must be physically preflop, never stale flop');
setPot(0.15, '09:40 88 preflop raised pot');
attemptPotRegression(0.03, '09:40 delayed old pot');
setBoard(board(['7','diamonds'],['2','hearts'],['6','spades']), '09:50 88 real flop');
assert.deepEqual(machine.state.board.map((c) => `${c.rank}${c.suit}`), ['7diamonds','2hearts','6spades'], '09:50: current physical flop must own the snapshot');
setPot(0.22, '09:50 88 flop pot');
setBoard(board(['7','diamonds'],['2','hearts'],['6','spades'],['9','hearts']), '10:10 88 turn');

physicalRedeal(hero('K','spades','T','clubs'), '10:40 KT new hand');
assert.deepEqual(machine.state.board, [], '10:40: prior 88 board must be gone before KT decision');
setPot(0.08, '10:40 KT preflop');
setBoard(board(['6','spades'],['3','diamonds'],['3','hearts']), '10:50 KT flop');
setPot(0.15, '10:50 KT flop pot');

physicalRedeal(hero('K','clubs','9','hearts'), '11:30 K9 new hand');
assert.deepEqual(machine.state.board, [], '11:30: prior flop must not leak into K9 preflop');
setPot(0.03, '11:30 K9 preflop');
setBoard(board(['J','hearts'],['2','diamonds'],['A','hearts']), '11:50 K9 flop');
setBoard(board(['J','hearts'],['2','diamonds'],['A','hearts'],['6','spades']), '12:10 K9 turn');

physicalRedeal(hero('9','hearts','4','diamonds'), '12:30 94 new hand');
setPot(0.03, '12:30 94 preflop');

physicalRedeal(hero('A','spades','5','hearts'), '12:50 A5 new hand');
setPot(0.03, '12:50 A5 preflop');

// Contract checks for the two remaining strategy-safety properties observed in
// the recording: never teach on 1/2 and never promote a forced blind to aggressor.
const safety = fs.readFileSync(new URL('../src/solver/study-safety-gate-r14.js', import.meta.url), 'utf8');
const evidence = fs.readFileSync(new URL('../src/vision/ai-decision-evidence-guard-r14.js', import.meta.url), 'utf8');
assert.match(safety, /rawStableFrames >= 2/, 'strategy must require raw 2/2');
assert.match(safety, /stableFrames >= 2/, 'strategy must require consensus 2/2');
assert.match(evidence, /context\.mode !== 'raised'/, 'unopened\/limped preflop must have no aggressor');
assert.match(evidence, /return null;/, 'forced blinds must sanitize aggressor to null');

console.log(`VIDEO SHADOW REPLAY R14 passed · ${machine.handId} physical hands · final generation ${arbiter.generation}`);
