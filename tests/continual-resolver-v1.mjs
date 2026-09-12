import assert from 'node:assert/strict';
import { evaluateBest, compareHoldem } from '../src/solver/hand-evaluator.js';
import { buildOpponentRange } from '../src/solver/range-engine.js';
import { estimateEquity } from '../src/solver/equity-engine.js';
import { decidePrepared, prepareResolverState, resolverFingerprint } from '../src/solver/continual-resolver.js';

const c = (rank, suit) => ({ rank, suit, confidence: 1 });
const royal = [c('A','spades'),c('K','spades'),c('Q','spades'),c('J','spades'),c('T','spades')];
const quads = [c('A','spades'),c('A','hearts'),c('A','diamonds'),c('A','clubs'),c('K','spades')];
assert(evaluateBest(royal) > evaluateBest(quads), 'straight flush must beat quads');

const hero = [c('A','spades'), c('A','hearts')];
const villain = [c('K','diamonds'), c('K','hearts')];
const board = [c('A','clubs'), c('K','clubs'), c('7','diamonds'), c('2','hearts'), c('3','spades')];
assert.equal(compareHoldem(hero, villain, board), 1, 'AAA must beat KKK on this river');

const fixedRange = { combos: [{ cards: villain, weight: 1 }] };
const riverEq = estimateEquity({ hero, board, range: fixedRange, budget: 100, seed: 'fixed' });
assert.equal(riverEq.equity, 1);
assert.equal(riverEq.exactRiver, true);

const state = {
  street: 'river', heroToAct: true, hero, board, pot: 1200,
  actions: [{ type: 'fold' }, { type: 'call', amount: 400 }],
};
const events = [
  { street: 'preflop', actorName: 'Vilao', action: 'raise', amount: 120, confidence: .95 },
  { street: 'flop', actorName: 'Vilao', action: 'bet', amount: 180, confidence: .95 },
  { street: 'turn', actorName: 'Vilao', action: 'bet', amount: 360, confidence: .95 },
  { street: 'river', actorName: 'Vilao', action: 'bet', amount: 400, confidence: .95 },
];
const table = {
  confidence: .92, heroPosition: 'BTN', effectiveStack: 1800,
  seats: [
    { seatIndex: 0, actorName: 'Vilao', position: 'BB', stack: 1800, committed: 400, folded: false, hero: false, confidence: .92 },
    { seatIndex: 1, actorName: 'Hero', position: 'BTN', stack: 1800, committed: 0, folded: false, hero: true, confidence: .92 },
  ],
};
const context = { handId: 21, state, events, actorName: 'Vilao', table };
const fp = resolverFingerprint(context);
assert(fp.includes('Vilao'));

const range = buildOpponentRange({ hero, board, events, actorName: 'Vilao', table, maxCombos: 180 });
assert(range.combos.length > 80 && range.combos.length <= 180);
const blocked = new Set([...hero, ...board].map((x) => `${x.rank}${x.suit[0]}`));
for (const combo of range.combos) for (const card of combo.cards) assert(!blocked.has(`${card.rank}${card.suit[0]}`), 'range must respect blockers');

const t0 = performance.now();
const prepared = prepareResolverState(context, { budget: 220 });
const elapsed = performance.now() - t0;
assert(Number.isFinite(prepared.equity.equity));
assert(prepared.range.combos.length > 0);
assert(elapsed < 750, `bounded local prepare should stay sub-second in CI, got ${elapsed.toFixed(1)}ms`);

const strongPrepared = { ...prepared, pot: 1000, equity: { equity: .86, stderr: .01 }, evidenceQuality: .9, activeOpponents: 1 };
const strongDecision = decidePrepared(strongPrepared, [{ type: 'fold' }, { type: 'call', amount: 300 }]);
assert.equal(strongDecision.decision, 'call');
const weakPrepared = { ...prepared, pot: 1000, equity: { equity: .12, stderr: .01 }, evidenceQuality: .9, activeOpponents: 1 };
const weakDecision = decidePrepared(weakPrepared, [{ type: 'fold' }, { type: 'call', amount: 700 }]);
assert.equal(weakDecision.decision, 'fold');

// Real R14 safety regression: if the runtime has not reconstructed the
// opponent/aggressor, a generic prior range must never authorize a CALL.
const unknownOpponentPrepared = {
  ...strongPrepared,
  actorName: null,
  actorKnown: false,
  actorEventCount: 0,
  eventCount: 0,
  table: null,
};
const unsafeUnknownCall = decidePrepared(unknownOpponentPrepared, [
  { type: 'fold' },
  { type: 'call', amount: 1497 },
  { type: 'raise', amount: 1497 },
]);
assert.equal(unsafeUnknownCall.decision, 'insufficient');
assert.equal(unsafeUnknownCall.confidence, 0);

assert(strongDecision.ms < 20, `final action comparison should be tiny, got ${strongDecision.ms.toFixed(2)}ms`);

console.log(`CONTINUAL RESOLVER V1 regressions passed · prepare ${elapsed.toFixed(1)}ms · decide ${strongDecision.ms.toFixed(2)}ms`);
