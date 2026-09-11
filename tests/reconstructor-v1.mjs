import assert from 'node:assert/strict';
import { ActionTimeline } from '../src/core/action-timeline.js';
import { parseActionLogLine, parseActionLogText } from '../src/core/action-log-parser.js';
import { assessOpponent } from '../src/opponent-model.js';

const pt = parseActionLogLine('Jogador X: aumenta 200 para 600', { handId: 4, street: 'preflop' });
assert.equal(pt.actorName, 'Jogador X');
assert.equal(pt.action, 'raise');
assert.equal(pt.amount, 600);

const en = parseActionLogLine('Villain42: calls 1.200', { handId: 4, street: 'flop' });
assert.equal(en.action, 'call');
assert.equal(en.amount, 1200);

const parsed = parseActionLogText(`Ana: aposta 300\nBruno: desiste\nAna: aposta 300`, { handId: 5, street: 'turn' });
assert.equal(parsed.length, 2);
assert.equal(parsed[0].action, 'bet');
assert.equal(parsed[1].action, 'fold');

const timeline = new ActionTimeline();
timeline.resetHand(9);
assert.equal(timeline.append({ handId: 8, street: 'flop', actorName: 'Old', action: 'bet', amount: 100 }), false);
assert.equal(timeline.append({ handId: 9, street: 'flop', actorName: 'Vilao', action: 'bet', amount: 100 }), true);
assert.equal(timeline.append({ handId: 9, street: 'flop', actorName: 'Vilao', action: 'bet', amount: 100 }), false);
assert.equal(timeline.append({ handId: 9, street: 'turn', actorName: 'Vilao', action: 'bet', amount: 250 }), true);
assert.equal(timeline.snapshot().events.length, 2);

a = null;
const polarEvents = [
  { actorName: 'Vilao', street: 'turn', action: 'call', amount: 400 },
  { actorName: 'Vilao', street: 'river', action: 'raise', amount: 1500 },
];
const polar = assessOpponent({ actorName: 'Vilao', events: polarEvents, board: [{rank:'A'},{rank:'7'},{rank:'2'},{rank:'T'},{rank:'3'}], potBefore: 1000 });
assert.equal(polar.status, 'polar');
assert(polar.bluffSignal >= 55);
assert.match(polar.disclaimer, /inferência de range/i);
assert.doesNotMatch(polar.label, /confirmado/i);

const valueEvents = [
  { actorName: 'Reg', street: 'flop', action: 'bet', amount: 200 },
  { actorName: 'Reg', street: 'turn', action: 'bet', amount: 500 },
  { actorName: 'Reg', street: 'river', action: 'bet', amount: 900 },
];
const value = assessOpponent({ actorName: 'Reg', events: valueEvents, board: [{rank:'K'},{rank:'Q'},{rank:'4'},{rank:'2'},{rank:'9'}], potBefore: 1200 });
assert.equal(value.status, 'value-leaning');
assert(value.valueSignal > value.bluffSignal);

console.log('HAND RECONSTRUCTOR V1 range-only regressions passed');
