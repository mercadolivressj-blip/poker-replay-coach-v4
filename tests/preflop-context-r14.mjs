import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyPreflopContext } from '../src/core/preflop-context-r14.js';
import { recommendUnopenedPreflop } from '../src/solver/preflop-policy-r14.js';

const c = (rank, suit) => ({ rank, suit });
const actionsSB = [
  { type: 'fold', amount: null },
  { type: 'call', amount: 0.01 },
  { type: 'raise', amount: 0.04 },
];

const sbSpot = [
  { seatIndex: 0, actorName: 'BTN', position: 'BTN', committed: 0, folded: true, hero: false },
  { seatIndex: 1, actorName: 'wruckzinho', position: 'SB', committed: 0.01, folded: false, hero: true },
  { seatIndex: 2, actorName: 'FRYMONY', position: 'BB', committed: 0.02, folded: false, hero: false },
];
let ctx = classifyPreflopContext({ seats: sbSpot, heroCommitted: 0.01, proposedAggressorName: 'FRYMONY', proposedAggressorCommitted: 0.02 });
assert.equal(ctx.mode, 'unopened', 'posted BB must not be treated as aggression');
assert.equal(ctx.aggressorName, null);
assert.equal(ctx.bbName, 'FRYMONY');

let out = recommendUnopenedPreflop({
  hero: [c('A','diamonds'), c('6','hearts')],
  position: 'SB',
  actions: actionsSB,
  pot: 0.03,
  sb: 0.01,
  bb: 0.02,
});
assert.equal(out.decision, 'raise', 'A6o SB unopened must not be auto-folded');
assert.match(out.reason, /blinds.*não agressão|não agressão|unopened/i);

out = recommendUnopenedPreflop({
  hero: [c('9','clubs'), c('7','clubs')],
  position: 'HJ',
  actions: [{ type: 'fold' }, { type: 'call', amount: 0.02 }, { type: 'raise', amount: 0.06 }],
  pot: 0.03,
  sb: 0.01,
  bb: 0.02,
});
assert.equal(out.decision, 'fold', '97s HJ is below the deterministic HJ open cutoff in this coach');

const raisedSpot = [
  { seatIndex: 0, actorName: 'RaginRJ', position: 'UTG', committed: 0.06, folded: false, hero: false, visibleAction: 'raise' },
  { seatIndex: 1, actorName: 'SBPlayer', position: 'SB', committed: 0.01, folded: false, hero: false },
  { seatIndex: 2, actorName: 'BBPlayer', position: 'BB', committed: 0.02, folded: false, hero: false },
  { seatIndex: 3, actorName: 'wruckzinho', position: 'BTN', committed: 0, folded: false, hero: true },
];
ctx = classifyPreflopContext({ seats: raisedSpot, heroCommitted: 0, proposedAggressorName: 'RaginRJ', proposedAggressorCommitted: 0.06 });
assert.equal(ctx.mode, 'raised');
assert.equal(ctx.aggressorName, 'RaginRJ');
assert.equal(ctx.aggressorCommitted, 0.06);

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const gate = fs.readFileSync(new URL('../src/solver/study-safety-gate-r14.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../src/solver/single-decision-ui-r14.js', import.meta.url), 'utf8');
assert.match(bootstrap, /preflop-policy-runtime-r14/);
assert.match(bootstrap, /single-decision-ui-r14/);
assert.match(gate, /unopenedPreflopOwnedByPolicy/);
assert.match(gate, /preflop-unopened-policy-r14/);
assert.match(ui, /decision-store-only/);
assert.match(ui, /getDecision/);

console.log('PREFLOP CONTEXT R14 passed');
