import assert from 'node:assert/strict';
import { classifyPreflopHand, preflopHandKey, recommendPreflop } from '../src/preflop.js';
import { recommend } from '../src/strategy.js';

const c = (rank, suit = null) => ({ rank, suit });
const facing = [{ type: 'fold' }, { type: 'call', amount: 100 }, { type: 'raise', amount: 400 }];

assert.equal(preflopHandKey([c('A', 'spades'), c('K', 'spades')]), 'AKs');
assert.equal(preflopHandKey([c('K', 'hearts'), c('A', 'spades')]), 'AKo');
assert.equal(preflopHandKey([c('A'), c('J')]), 'AJ?');
assert.equal(preflopHandKey([c('7'), c('7')]), '77');

assert.equal(classifyPreflopHand([c('A', 'spades'), c('A', 'hearts')]).category, 'premium');
assert.equal(classifyPreflopHand([c('A', 'spades'), c('J', 'spades')]).category, 'strong');
assert.equal(classifyPreflopHand([c('A'), c('J')]).category, 'playable');
assert.equal(classifyPreflopHand([c('7', 'clubs'), c('6', 'clubs')]).category, 'speculative');
assert.equal(classifyPreflopHand([c('7', 'clubs'), c('2', 'hearts')]).category, 'fold');

let out = recommendPreflop({ hero: [c('A', 'spades'), c('A', 'hearts')], pot: 300, actions: facing });
assert.equal(out.decision, 'AUMENTAR');
assert.match(out.details[0], /AA/);

out = recommendPreflop({ hero: [c('7', 'clubs'), c('2', 'hearts')], pot: 300, actions: facing });
assert.equal(out.decision, 'DESISTIR');

out = recommendPreflop({ hero: [c('7', 'clubs'), c('6', 'clubs')], pot: 900, actions: facing });
assert.equal(out.decision, 'PAGAR');

out = recommendPreflop({ hero: [c('7', 'clubs'), c('6', 'clubs')], pot: 300, actions: facing });
assert.equal(out.decision, 'DESISTIR');

out = recommendPreflop({ hero: [c('A'), c('J')], pot: 500, actions: facing });
assert.equal(out.decision, 'PAGAR');
assert.match(out.details.join(' '), /conservadora/i);

out = recommendPreflop({ hero: [c('A', 'spades'), c('K', 'spades')], pot: 300, actions: [{ type: 'check' }, { type: 'raise', amount: 400 }] });
assert.equal(out.decision, 'AUMENTAR');

out = recommend({ hero: [c('A', 'spades'), c('A', 'hearts')], board: [], street: 'preflop', pot: 300, actions: facing });
assert.equal(out.decision, 'AUMENTAR');
assert.match(out.details[0], /premium/);

console.log('PRE-FLOP V1 regression suite passed');
