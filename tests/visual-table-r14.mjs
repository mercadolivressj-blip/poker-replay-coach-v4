import assert from 'node:assert/strict';
import { inferPokerStarsTableSize, parseSeatText, parsePokerStarsNumber, seatRectsFromFelt, inferActionFromStacks, stableNumericObservation } from '../src/vision/pokerstars-table-reader-r14.js';
import { estimateMultiwayEquity } from '../src/solver/equity-engine.js';
import { decidePrepared } from '../src/solver/continual-resolver.js';

const c = (rank, suit) => ({ rank, suit, confidence: 1 });

assert.equal(parsePokerStarsNumber('1.497'), 1497);
assert.equal(parsePokerStarsNumber('US$ 0,77'), 0.77);
assert.equal(inferPokerStarsTableSize('$5.00 NL Holdem [6-Max, Turbo]'), 6);
assert.equal(inferPokerStarsTableSize('No Limit Holdem - 9-Max'), 9);
assert.equal(inferPokerStarsTableSize('No Limit Holdem US$0,01/US$0,02'), null);

const player = parseSeatText('Superfsh1\n1.497');
assert.equal(player.actorName, 'Superfsh1');
assert.equal(player.stack, 1497);
assert.equal(player.occupied, true);

const shove = parseSeatText('Superfsh1\nAll In');
assert.equal(shove.actorName, 'Superfsh1');
assert.equal(shove.visibleAction, 'allin');
assert.equal(shove.occupied, true);

const fold = parseSeatText('paul8mag\nDesiste');
assert.equal(fold.visibleAction, 'fold');
const empty = parseSeatText('Lugar\nVazio');
assert.equal(empty.empty, true);
assert.equal(empty.occupied, false);
const away = parseSeatText('celsspek1806\nAusente');
assert.equal(away.away, true);
assert.equal(away.actorName, 'celsspek1806');
const garbage = parseSeatText('fA Ua\n4');
assert.equal(garbage.actorName, null, 'whitespace OCR hallucination must not become a player name');

const felt = { x: 0.20, y: 0.20, w: 0.60, h: 0.45 };
const rects6 = seatRectsFromFelt(felt, 6);
const rects9 = seatRectsFromFelt(felt, 9);
assert.equal(rects6.length, 6);
assert.equal(rects9.length, 9);
assert(rects9.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.00001 && r.y + r.h <= 1.00001));
assert.equal(rects9[0].seatIndex, 0);

const inferredAllin = inferActionFromStacks({ previousStack: 1497, currentStack: 0, previousCommitted: 3, maxCommitted: 23 });
assert.equal(inferredAllin.action, 'allin');
assert(inferredAllin.committed > 1400);

let memory = { value: 1500, pending: null, hits: 0 };
let obs = stableNumericObservation(memory, 497);
assert.equal(obs.accepted, false, 'one noisy OCR frame must not replace the stack');
obs = stableNumericObservation(obs.memory, 1500);
assert.equal(obs.value, 1500, 'returning to the stable stack clears the false candidate');

// Exact showdown ranges from the replay that exposed the bad K6 call.
const hero = [c('K', 'spades'), c('6', 'clubs')];
const qq = { actorName: 'OkBlasted', combos: [{ cards: [c('Q', 'clubs'), c('Q', 'hearts')], weight: 1 }] };
const kj = { actorName: 'Superfsh1', combos: [{ cards: [c('K', 'diamonds'), c('J', 'diamonds')], weight: 1 }] };
const multi = estimateMultiwayEquity({ hero, board: [], ranges: [qq, kj], budget: 2400, seed: 'k6-qq-kj-r14' });
assert.equal(multi.multiway, true);
assert.equal(multi.opponents, 2);
assert(multi.equity > 0.03 && multi.equity < 0.18, `K6o should be a large dog three-way, got ${multi.equity}`);

const decision = decidePrepared({
  pot: 3022,
  street: 'preflop',
  equity: multi,
  range: { summary: { strongShare: 0.6, drawShare: 0, airShare: 0.1, comboCount: 2 } },
  rangeSummary: { strongShare: 0.6, drawShare: 0, airShare: 0.1, comboCount: 2, rangeCount: 2 },
  opponentRanges: [qq, kj],
  opponentActors: ['OkBlasted', 'Superfsh1'],
  activeOpponents: 2,
  actorKnown: true,
  opponentEventCount: 2,
  actorEventCount: 1,
  evidenceQuality: 0.9,
  sampleCertainty: 0.95,
  eventCount: 2,
  localChatCount: 0,
  table: { effectiveStack: 1497 },
}, [{ type: 'fold' }, { type: 'call', amount: 1497 }]);
assert.equal(decision.decision, 'fold', 'K6o facing two full-stack all-ins must not be recommended as a call');

console.log(`VISUAL TABLE R14 passed · 6/9-max · K6 equity ${(multi.equity * 100).toFixed(1)}%`);
