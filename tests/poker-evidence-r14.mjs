import assert from 'node:assert/strict';
import fs from 'node:fs';
import { engagedOpponentNames, resolveAggressorEvidence } from '../src/core/poker-evidence-r14.js';
import { prepareResolverState } from '../src/solver/continual-resolver.js';

const seats = [
  { seatIndex: 0, actorName: 'tlcompositor', stack: 4.24, committed: 0.02, folded: false, hero: false, visibleAction: null, confidence: .96 },
  { seatIndex: 1, actorName: 'meelis9', stack: 1.95, committed: 0.05, folded: false, hero: false, visibleAction: null, confidence: .96 },
  { seatIndex: 2, actorName: 'chiefmaars', stack: 4.18, committed: 0.12, folded: false, hero: false, visibleAction: 'raise', confidence: .97 },
  { seatIndex: 3, actorName: 'Hero', stack: .80, committed: 0.02, folded: false, hero: true, visibleAction: null, confidence: .98 },
  { seatIndex: 4, actorName: 'ericjo333', stack: 1.58, committed: 0, folded: false, hero: false, visibleAction: null, confidence: .95 },
  { seatIndex: 5, actorName: 'Delbroek', stack: .75, committed: 0.01, folded: false, hero: false, visibleAction: null, confidence: .95 },
];

const repaired = resolveAggressorEvidence({ proposedName: 'Aumento', proposedCommitted: .12, heroCommitted: .02, seats });
assert.equal(repaired.actorName, 'chiefmaars');
assert.equal(repaired.committed, .12);
assert.equal(repaired.source, 'explicit-table-action');

const events = [
  { street: 'preflop', actorName: 'chiefmaars', action: 'raise', amount: .12, confidence: .94 },
];
let engaged = engagedOpponentNames({ seats, events, heroName: 'Hero', primaryActor: 'chiefmaars', street: 'preflop' });
assert.deepEqual(engaged, ['chiefmaars'], 'unacted seated players must not become guaranteed showdown ranges');

const withCaller = [...events, { street: 'preflop', actorName: 'meelis9', action: 'call', amount: .12, confidence: .93 }];
engaged = engagedOpponentNames({ seats, events: withCaller, heroName: 'Hero', primaryActor: 'chiefmaars', street: 'preflop' });
assert.deepEqual(new Set(engaged), new Set(['chiefmaars','meelis9']));

const afterFold = [...withCaller, { street: 'preflop', actorName: 'meelis9', action: 'fold', amount: null, confidence: .95 }];
engaged = engagedOpponentNames({ seats, events: afterFold, heroName: 'Hero', primaryActor: 'chiefmaars', street: 'preflop' });
assert.deepEqual(engaged, ['chiefmaars']);

const c = (rank, suit) => ({ rank, suit, confidence: 1 });
const context = {
  handId: 77,
  state: {
    street: 'preflop',
    heroToAct: true,
    hero: [c('J','hearts'), c('7','spades')],
    board: [],
    pot: .08,
    actions: [{ type: 'fold' }, { type: 'call', amount: .05 }, { type: 'raise', amount: .08 }],
  },
  events,
  actorName: 'Aumento',
  table: { confidence: .96, heroPosition: 'BTN', effectiveStack: .8, seats },
};
const prepared = prepareResolverState(context, { budget: 80 });
assert.equal(prepared.actorName, 'chiefmaars', 'resolver must replace an action label with the real aggressor');
assert.equal(prepared.activeOpponents, 1, 'resolver must not model every seated player as a guaranteed opponent');
assert.deepEqual(prepared.opponentActors, ['chiefmaars']);
assert.equal(prepared.actorCurrentFrameConfirmed, true);

const capacitySource = fs.readFileSync(new URL('../src/vision/table-capacity-stabilizer-r14.js', import.meta.url), 'utf8');
assert.match(capacitySource, /candidateHits >= 2/);
assert.match(capacitySource, /contradictionHits >= 4/);
assert.match(capacitySource, /originalIngest\(snapshot\)/);
assert.doesNotMatch(capacitySource, /emptyPhysicalSlot/);

console.log('POKER EVIDENCE R14 passed');
