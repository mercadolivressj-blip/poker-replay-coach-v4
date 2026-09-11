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

// Confirmed Hero cards are immutable inside one hand. A rank classifier blip such
// as 78 -> J8 must be rejected, while suit enrichment on the same ranks is allowed.
const sticky = new HandMachine();
assert.equal(sticky.observeHero(['7','8'], true, 1000).newHand, true);
assert.equal(sticky.setHero([{ rank: '7', suit: null, confidence: .9 }, { rank: '8', suit: null, confidence: .9 }], sticky.handId), true);
assert.equal(sticky.setHero([{ rank: 'J', suit: 'spades', confidence: .99 }, { rank: '8', suit: 'hearts', confidence: .99 }], sticky.handId), false, 'rank mutation inside hand must be rejected');
assert.deepEqual(sticky.state.hero.map((x) => x.rank), ['7','8']);
assert.equal(sticky.setHero([{ rank: '7', suit: 'clubs', confidence: .95, suitConfidence: .92 }, { rank: '8', suit: 'diamonds', confidence: .95, suitConfidence: .92 }], sticky.handId), true);
assert.deepEqual(sticky.state.hero.map((x) => `${x.rank}:${x.suit}`), ['7:clubs','8:diamonds']);

// Continuous semantic disagreement is detector uncertainty, not a new hand.
for (const t of [1060, 1120, 1180, 1240, 1300, 1360, 1420]) {
  assert.equal(sticky.observeHero(['J','8'], true, t).newHand, false, 'J8 jitter must not rotate a continuously visible 78 hand');
}
assert.equal(sticky.handId, 1);
assert.deepEqual(sticky.state.hero.map((x) => x.rank), ['7','8']);

// Short/long detector gaps must not erase a hand if the same cards reappear.
for (const t of [1500, 1540, 1580, 1620, 1660, 1700, 1740]) sticky.observeHero(null, false, t);
const sameBack = sticky.observeHero(['7','8'], true, 1800);
assert.equal(sameBack.newHand, false, 'same cards reappearing after detector dropout stay in the same hand');
assert.equal(sticky.handId, 1);
assert.deepEqual(sticky.state.hero.map((x) => x.rank), ['7','8']);

// After a real disappearance, a different stable semantic pair may start the next hand.
for (const t of [1900, 1940, 1980, 2020, 2060, 2100, 2140]) sticky.observeHero(null, false, t);
assert.equal(sticky.observeHero(['J','8'], true, 2200).newHand, false);
assert.equal(sticky.observeHero(['J','8'], true, 2260).newHand, false);
assert.equal(sticky.observeHero(['J','8'], true, 2320).newHand, true, 'real disappearance plus three stable reads may rotate the hand');
assert.equal(sticky.handId, 2);
assert.equal(sticky.state.hero.length, 0, 'new hand starts blank until its cards are reconfirmed');

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
assert.match(rankSource, /'J': Object\.freeze\(\{ '7':/);
assert.match(rankSource, /'7': Object\.freeze\(\{ 'K': 0\.22, 'J':/);
assert.match(rankSource, /'T': Object\.freeze\(\{ '6':/);
const stateSource = fs.readFileSync(new URL('../src/core/state-machine.js', import.meta.url), 'utf8');
assert.match(stateSource, /semantic-change-without-transition/);
assert.match(stateSource, /sameRanks/);
const localActionRuntime = fs.readFileSync(new URL('../src/vision/local-action-runtime.js', import.meta.url), 'utf8');
assert.match(localActionRuntime, /recentLines/);
assert.match(localActionRuntime, /2400/);

console.log('ROBUST REPLAY V2 regressions passed');
