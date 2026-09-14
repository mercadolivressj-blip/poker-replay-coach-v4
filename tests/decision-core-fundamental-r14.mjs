import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateDecisionCore } from '../src/solver/decision-core-r14.js';
import { calculateFundamentalDecision } from '../src/solver/fundamental-resolver-runtime-r14.js';
import { estimateActionValues } from '../src/solver/value-engine.js';

const card = (rank, suit) => ({ rank, suit, confidence: 1 });

function baseFixture() {
  const hero = [card('9','hearts'), card('8','hearts')];
  const board = [card('K','diamonds'), card('8','clubs'), card('7','spades')];
  const seats = [
    { seatIndex: 0, actorName: 'Villain', stack: 1.20, committed: 0, dealer: true, folded: false, hero: false, position: 'BTN', confidence: 0.9 },
    { seatIndex: 1, actorName: 'Hero', stack: 0.80, committed: 0, dealer: false, folded: false, hero: true, position: 'BB', confidence: 0.95 },
  ];
  const machine = {
    handId: 4,
    state: {
      hero,
      board,
      street: 'flop',
      pot: 0.12,
      actions: [{ type: 'check', amount: null }, { type: 'bet', amount: 0.08 }],
      heroToAct: true,
    },
  };
  const authority = { manualOnly: true, heroLocked: true, handId: 4 };
  const fast = {
    handId: 4,
    lastSeenAt: 1000,
    lastLatencyMs: 700,
    confidence: 0.94,
    boardConfidence: 0.94,
    potConfidence: 0.92,
    actionsConfidence: 0.95,
    board,
    pot: 0.12,
    actions: [{ type: 'check', amount: null }, { type: 'bet', amount: 0.08 }],
    heroToAct: true,
    aggressorName: null,
    aggressorCommitted: null,
    heroCommitted: 0,
  };
  const full = {
    handId: 4,
    lastSeenAt: 950,
    lastLatencyMs: 900,
    confidence: 0.94,
    seatsConfidence: 0.90,
    boardConfidence: 0.90,
    potConfidence: 0.90,
    board,
    pot: 0.12,
    seats,
  };
  const table = {
    handId: 4,
    observedAt: 980,
    confidence: 0.90,
    dealerSeat: 0,
    heroPosition: 'BB',
    seats,
  };
  return { machine, authority, fast, full, table };
}

// 1) Current-state core is enough without action history when Hero/board/pot/
// stacks/players/position/current buttons all agree.
{
  const f = baseFixture();
  const core = evaluateDecisionCore({ ...f, at: 1500 });
  assert.equal(core.ready, true);
  assert.ok(core.confidence >= 70);
  assert.equal(core.activeOpponentCount, 1);
  assert.equal(core.effectiveStack, 0.8);
}

// 2) A slower full-frame source may be one street/frame behind. When the logical
// board and the fast current-turn source agree exactly, that lag is advisory: it
// reduces confidence and is exposed diagnostically, but does not veto strategy.
{
  const f = baseFixture();
  f.full = { ...f.full, board: [card('K','diamonds'), card('8','hearts'), card('7','spades')] };
  const core = evaluateDecisionCore({ ...f, at: 1500 });
  assert.equal(core.ready, true);
  assert.equal(core.fullBoardConflict, true);
  assert.match(core.reason, /frame inteiro atrasado/i);
}

// 3) Regression from the real replay: the full-frame reader can still show the
// previous pot (for example 0.05) while board/seats/stacks are already current.
// If the stable table tracker is not ready, those seats are still usable; the
// canonical current pot comes from machine + fast and the stale full pot only
// reduces confidence instead of causing LEITURA INSUFICIENTE.
{
  const f = baseFixture();
  f.table = null;
  f.full = { ...f.full, pot: 0.05 };
  const core = evaluateDecisionCore({ ...f, at: 1500 });
  assert.equal(core.ready, true);
  assert.equal(core.tableSource, 'full-frame-current-fallback-pot-lag');
  assert.equal(core.fullPotConflict, true);
  assert.match(core.reason, /pote atrasado/i);
  assert.equal(core.pot, 0.12);
}

// 4) Current physical action mismatch is decision-critical and blocks strategy.
{
  const f = baseFixture();
  f.fast = { ...f.fast, actions: [{ type: 'fold', amount: null }, { type: 'call', amount: 0.04 }, { type: 'raise', amount: 0.10 }] };
  const core = evaluateDecisionCore({ ...f, at: 1500 });
  assert.equal(core.ready, false);
  assert.match(core.reason, /botões físicos/i);
}

// 5) Generic/population calls are allowed only when the fundamental layer opts
// in explicitly. The refined resolver keeps its stricter actor requirement.
{
  const base = {
    equity: 0.40,
    pot: 0.15,
    actions: [{ type: 'fold', amount: null }, { type: 'call', amount: 0.06 }],
    rangeSummary: { strongShare: 0.2, drawShare: 0.1, airShare: 0.25, rangeCount: 1 },
    street: 'preflop',
    effectiveStack: 0.74,
    evidenceQuality: 0.78,
    actorKnown: false,
  };
  assert.deepEqual(estimateActionValues(base), []);
  const values = estimateActionValues({ ...base, allowGenericCall: true });
  assert.ok(values.some((value) => value.action === 'call'));
  assert.ok(values.some((value) => value.action === 'fold'));
}

// 6) Regression for the user's 98s/CO complaint: if the CURRENT state really is
// unopened, the deterministic positional policy must open 98s instead of using
// a stale-history fold.
{
  const core = {
    ready: true,
    confidence: 92,
    handId: 9,
    street: 'preflop',
    hero: [card('9','hearts'), card('8','hearts')],
    board: [],
    pot: 0.03,
    actions: [
      { type: 'fold', amount: null },
      { type: 'call', amount: 0.02 },
      { type: 'raise', amount: 0.06 },
    ],
    activeOpponents: [
      { seatIndex: 1, actorName: 'SB', stack: 1.0, committed: 0.01, position: 'SB', folded: false },
      { seatIndex: 2, actorName: 'BB', stack: 1.0, committed: 0.02, position: 'BB', folded: false },
    ],
    activeOpponentCount: 2,
    seats: [],
    heroPosition: 'CO',
    effectiveStack: 1.0,
    heroCommitted: 0,
    aggressorName: null,
    aggressorKnown: false,
    aggressorCommitted: null,
    preflopMode: 'unopened',
    preflopContext: { sb: 0.01, bb: 0.02 },
  };
  const result = calculateFundamentalDecision(core);
  assert.equal(result.decision, 'AUMENTAR');
  assert.match(result.mode, /fundamental-unopened/);
}

// 7) Wiring regression: R14 no longer imports the old history-blocking safety
// gate or separate preflop runtime. Fundamental current-state layer + refined
// resolver are the two strategy layers.
{
  const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
  const manualEntry = fs.readFileSync(new URL('../src/vision/manual-hero-entry-r14.js', import.meta.url), 'utf8');
  const decisionStore = fs.readFileSync(new URL('../src/core/decision-store.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /decision-core-gate-r14/);
  assert.match(bootstrap, /fundamental-resolver-runtime-r14/);
  assert.doesNotMatch(bootstrap, /study-safety-gate-r14/);
  assert.doesNotMatch(bootstrap, /preflop-policy-runtime-r14/);
  assert.doesNotMatch(manualEntry, /'r14-board-cleared-postflop'/);
  assert.match(manualEntry, /stable-dealer-move-2of2/);
  assert.match(decisionStore, /lockFollowsDecisionEpoch: true/);
  assert.match(decisionStore, /invalidateStaleLock/);
}

console.log('DECISION CORE FUNDAMENTAL R14 passed');
