import assert from 'node:assert/strict';
import {scoreFive,evaluateSeven,compareHoldem,exactEquityVsHand,deck} from '../src/math/holdem-evaluator.js';

assert.equal(deck().length,52);
assert.equal(new Set(deck()).size,52);
assert.equal(scoreFive(['Ah','Kh','Qh','Jh','Th']).name,'straight-flush');
assert.equal(scoreFive(['As','Ad','Ac','Kd','Kh']).name,'full-house');
assert.equal(scoreFive(['2c','3d','4h','5s','Ah']).name,'straight');

// Critical regression: a flush plus a straight using another suit is NOT a straight flush.
const tricky=evaluateSeven(['Ah','Kh','Qh','Jh','9h','Tc','8d']);
assert.equal(tricky.name,'flush');

const cmp=compareHoldem(['As','Ad'],['Ks','Kd'],['2c','3c','4d','7h','9s']);
assert.equal(cmp.result,1);

const river=exactEquityVsHand(['As','Ad'],['Ks','Kd'],['2c','3c','4d','7h','9s']);
assert.equal(river.total,1);
assert.equal(river.equity,1);

const boardPlays=exactEquityVsHand(['2c','3d'],['4c','5d'],['Ah','Kh','Qh','Jh','Th']);
assert.equal(boardPlays.total,1);
assert.equal(boardPlays.equity,.5);

console.log('PASS — MTT holdem evaluator regressions');
