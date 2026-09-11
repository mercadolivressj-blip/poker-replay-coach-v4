import assert from 'node:assert/strict';
import fs from 'node:fs';
import { HeroCardConsensus } from '../src/core/hero-card-consensus.js';
import { HandMachine } from '../src/core/state-machine.js';
import { CALIBRATION_RANK_TEMPLATES } from '../src/core/rank-calibration.js';
import { parseDealerActionLine } from '../src/vision/local-action-parser.js';

const c = new HeroCardConsensus();
c.resetHand(1);
const k3 = [{ rank: 'K', confidence: .96, source: 'seeded-template' }, { rank: '3', confidence: .95, source: 'seeded-template' }];
const seven3 = [{ rank: '7', confidence: .94, source: 'seeded-template' }, { rank: '3', confidence: .95, source: 'seeded-template' }];

assert.equal(c.observe(k3, { handId: 1, now: 0 }).accepted, false, 'one strong bad frame must not commit');
assert.equal(c.observe(k3, { handId: 1, now: 65 }).accepted, false, 'two strong bad frames must not commit');
assert.equal(c.observe(seven3, { handId: 1, now: 130 }).accepted, false, 'new candidate needs temporal evidence');
assert.equal(c.observe(seven3, { handId: 1, now: 195 }).accepted, false);
assert.equal(c.observe(seven3, { handId: 1, now: 260 }).accepted, false, 'three good frames must still beat the conflicting history decisively');
const committed73 = c.observe(seven3, { handId: 1, now: 325 });
assert.equal(committed73.accepted, true);
assert.equal(committed73.key, '73');
assert.equal(c.observe(k3, { handId: 1, now: 390 }).reason, 'sticky-mismatch', 'committed Hero hand must not mutate inside hand');
assert.equal(c.snapshot().committed.key, '73');

c.resetHand(2);
const t6 = [{ rank: 'T', confidence: .92 }, { rank: '6', confidence: .91 }];
const tt = [{ rank: 'T', confidence: .97 }, { rank: 'T', confidence: .97 }];
assert.equal(c.observe(t6, { handId: 2, now: 0 }).accepted, false);
assert.equal(c.observe(t6, { handId: 2, now: 65 }).accepted, false);
const committedT6 = c.observe(t6, { handId: 2, now: 130 });
assert.equal(committedT6.accepted, true);
assert.equal(committedT6.key, 'T6');
assert.equal(c.observe(tt, { handId: 2, now: 195 }).reason, 'sticky-mismatch');
assert.equal(c.snapshot().committed.key, 'T6');

const machine = new HandMachine();
assert.equal(machine.observeHero(['7','3'], true, 1000).newHand, true);
for (const t of [1100, 1160, 1220, 1280]) assert.equal(machine.observeHero(['K','3'], true, t).newHand, false);
assert.equal(machine.observeHero(['K','3'], true, 1340).newHand, true, 'five stable semantic frames may declare a real new hand');

assert.deepEqual(parseDealerActionLine('tattou81: paga 200'), { actorName: 'tattou81', action: 'call', amount: 200 });
assert.deepEqual(parseDealerActionLine('Regnypontes: aumenta 200 para 600'), { actorName: 'Regnypontes', action: 'raise', amount: 600 });
assert.deepEqual(parseDealerActionLine('quemelster: passa'), { actorName: 'quemelster', action: 'check', amount: null });
assert.deepEqual(parseDealerActionLine('xsouthpawxx: bets 350'), { actorName: 'xsouthpawxx', action: 'bet', amount: 350 });
assert.deepEqual(parseDealerActionLine('abc: raises 200 to 700'), { actorName: 'abc', action: 'raise', amount: 700 });
assert.deepEqual(parseDealerActionLine('Dealer: tattou81 paga 200'), { actorName: 'tattou81', action: 'call', amount: 200 });
assert.deepEqual(parseDealerActionLine('Dealer: Regnypontes raises 200 to 700'), { actorName: 'Regnypontes', action: 'raise', amount: 700 });
assert.deepEqual(parseDealerActionLine('Dealer: quemelster: passa'), { actorName: 'quemelster', action: 'check', amount: null });
assert.equal(parseDealerActionLine('Dealer: Regnypontes, é a sua vez. Tem 8 segundos para agir'), null, 'turn prompt is not an action');
assert.equal(parseDealerActionLine('Dealer: Mão #123: wruckzinho ganha pote (1.323)'), null, 'pot result is not an action');
assert.equal(parseDealerActionLine('wruckzinho: boa mao'), null, 'ordinary chat is not an action');

assert(CALIBRATION_RANK_TEMPLATES['7']?.length, 'real replay 7 calibration must ship');
assert(CALIBRATION_RANK_TEMPLATES['6']?.length, 'real replay 6 calibration must ship');
assert(CALIBRATION_RANK_TEMPLATES['T']?.length, 'real replay T calibration must ship');
assert(CALIBRATION_RANK_TEMPLATES['3']?.length, 'real replay 3 calibration must ship');

const guardSource = fs.readFileSync(new URL('../src/core/runtime-guards.js', import.meta.url), 'utf8');
assert.match(guardSource, /hardDisabled/);
assert.match(guardSource, /not configured\|auth required/);
const resolverRuntime = fs.readFileSync(new URL('../src/solver/resolver-runtime.js', import.meta.url), 'utf8');
assert.match(resolverRuntime, /RESOLVER PRONTO/);
assert.match(resolverRuntime, /brain\.style\.display = 'none'/);
const rankSource = fs.readFileSync(new URL('../src/core/rank-classifier.js', import.meta.url), 'utf8');
assert.match(rankSource, /CALIBRATION_RANK_TEMPLATES/);
assert.match(rankSource, /CONFUSION_MARGIN/);
assert.match(rankSource, /'K': Object\.freeze\(\{ '7':/);
assert.match(rankSource, /'T': Object\.freeze\(\{ '6':/);
const localActionRuntime = fs.readFileSync(new URL('../src/vision/local-action-runtime.js', import.meta.url), 'utf8');
assert.match(localActionRuntime, /recentLines/);
assert.match(localActionRuntime, /2400/);

console.log('ROBUST REPLAY V1 regressions passed');
