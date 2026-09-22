import assert from 'node:assert/strict';
import {parsePokerStarsActionText,actionTextCandidate} from '../src/brain/action-text.js';

assert.equal(parsePokerStarsActionText('Desisto')?.action,'FOLD');
assert.equal(parsePokerStarsActionText('Passo')?.action,'CHECK');
assert.equal(parsePokerStarsActionText('Pago US$ 0,04')?.action,'CALL');
assert.equal(parsePokerStarsActionText('Pago US$ 0,04')?.amount,.04);
assert.equal(parsePokerStarsActionText('Aposto US$ 0,08')?.action,'BET');
assert.equal(parsePokerStarsActionText('Aumento para US$ 0,20')?.action,'RAISE');
assert.equal(parsePokerStarsActionText('ALL-IN')?.action,'ALLIN');
assert.equal(parsePokerStarsActionText('US$ 1,70'),null);
const c=actionTextCandidate({seatId:'left-high',actor:'Alice',street:'flop',text:'Aposto US$ 0,08',confidence:.81,at:123});
assert.equal(c.status,'provisional');
assert.equal(c.sovereign,false);
assert.equal(c.action,'BET');
assert.equal(c.actor,'Alice');
console.log('action-text-v1 regressions: OK');
