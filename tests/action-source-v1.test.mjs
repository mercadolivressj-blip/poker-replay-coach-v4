import assert from 'node:assert/strict';
import { extractPokerActionLines, mergeChronologicalHistory, combineActionSources } from '../src/brain/action-source.js';

const text=`Dealer: foo, é a sua vez. Tem 6 segundos para agir\nUTG folds\nHJ raises 0.05\n*** FLOP ***\nHero checks\nHJ bets 0.04\nTime Bank 9`;
const lines=extractPokerActionLines(text);
assert.deepEqual(lines,['UTG folds','HJ raises 0.05','*** FLOP ***','Hero checks','HJ bets 0.04']);

const a=['UTG folds','HJ raises 0.05'];
const b=['UTG folds','HJ raises 0.05','Hero calls 0.03','*** FLOP ***'];
assert.deepEqual(mergeChronologicalHistory(a,b),b);

const c=['Hero calls 0.03','*** FLOP ***','Hero checks'];
assert.deepEqual(mergeChronologicalHistory(b,c),['UTG folds','HJ raises 0.05','Hero calls 0.03','*** FLOP ***','Hero checks']);

const combined=combineActionSources({visionHistory:a,handHistoryText:'HJ raises 0.05\nHero calls 0.03\n*** FLOP ***',manualHistory:['Hero checks']});
assert.deepEqual(combined,['UTG folds','HJ raises 0.05','Hero calls 0.03','*** FLOP ***','Hero checks']);
console.log('action-source-v1 regressions: OK');
