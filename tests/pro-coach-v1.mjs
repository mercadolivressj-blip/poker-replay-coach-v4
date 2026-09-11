import assert from 'node:assert/strict';
import { profileBoard, heroBlockers } from '../src/coach/board-profiler.js';
import { OpponentStatsStore } from '../src/coach/opponent-stats.js';
import { buildProCoachReport } from '../src/coach/pro-coach.js';
import { assessOpponent } from '../src/opponent-model.js';

const c = (rank, suit = null) => ({ rank, suit });
const actionsFacing = (call = 1000, raise = 3000) => [
  { type: 'fold', amount: null },
  { type: 'call', amount: call },
  { type: 'raise', amount: raise },
];

// Board intelligence: distinguish bricks, draw-completing rivers and blockers.
{
  const brick = profileBoard([c('K','spades'), c('7','spades'), c('2','hearts'), c('4','clubs'), c('9','diamonds')]);
  assert.equal(brick.twoToneFlop, true);
  assert.equal(brick.changes.river.brick, true);
  assert.equal(brick.dominantSuitCount, 2);

  const flushRiver = profileBoard([c('K','spades'), c('7','spades'), c('2','hearts'), c('4','clubs'), c('3','spades')]);
  assert.equal(flushRiver.changes.river.flushPressureUp, true);
  assert.equal(flushRiver.threeFlushBoard, true);

  const blockers = heroBlockers([c('A','spades'), c('Q','hearts')], [c('K','spades'), c('7','spades'), c('2','spades'), c('4','clubs'), c('9','diamonds')]);
  assert(blockers.valueBlock >= 18);
  assert(blockers.features.some((x) => /nut flush/i.test(x)));
}

// Opponent range: river raises are value-dense by default, not auto-labelled as bluffs.
{
  const events = [
    { actorName:'Vilao', street:'flop', action:'bet', amount:200 },
    { actorName:'Vilao', street:'turn', action:'bet', amount:500 },
    { actorName:'Vilao', street:'river', action:'raise', amount:1500 },
  ];
  const out = assessOpponent({
    actorName:'Vilao', events,
    board:[c('K','spades'),c('7','spades'),c('2','hearts'),c('4','clubs'),c('3','spades')],
    potBefore:1000,
  });
  assert.equal(out.lineShape.riverRaise, true);
  assert(out.valueSignal > out.bluffSignal);
  assert.notEqual(out.status, 'possible-bluff');
  assert.doesNotMatch(out.label, /confirmado/i);
}

// Missed front-door draw + passive line + river overbet creates a genuinely polar spot.
{
  const events = [
    { actorName:'LAG', street:'flop', action:'check' },
    { actorName:'LAG', street:'turn', action:'check' },
    { actorName:'LAG', street:'river', action:'bet', amount:1500 },
  ];
  const out = assessOpponent({
    actorName:'LAG', events,
    board:[c('K','spades'),c('7','spades'),c('2','hearts'),c('4','clubs'),c('9','diamonds')],
    potBefore:1000,
  });
  assert.equal(out.status, 'polar');
  assert(out.bluffSignal >= 60);
  assert(out.reasons.some((x) => /draws que erraram/i.test(x)));
}

// Session learning: enough observed hands may influence the prior, but small samples stay weak.
const stats = new OpponentStatsStore();
for (let handId = 1; handId <= 10; handId++) {
  stats.observeHand(handId, [
    { actorName:'Maniac', street:'preflop', action:'raise', amount:200 },
    { actorName:'Maniac', street:'flop', action:'bet', amount:300 },
    { actorName:'Maniac', street:'turn', action:'bet', amount:700 },
    ...(handId % 2 ? [{ actorName:'Maniac', street:'river', action:'bet', amount:1200 }] : []),
  ]);
  stats.observeHand(handId, [{ actorName:'Nit', street:'preflop', action:'fold' }]);
}
{
  const maniac = stats.snapshot('Maniac');
  const nit = stats.snapshot('Nit');
  assert.equal(maniac.style, 'loose-aggressive');
  assert(maniac.bluffPriorAdjustment > 0);
  assert.equal(nit.style, 'tight-passive');
  assert(nit.bluffPriorAdjustment < 0);
}
{
  const tiny = new OpponentStatsStore();
  for (let h = 1; h <= 4; h++) tiny.observeHand(h, [{ actorName:'Novo', street:'preflop', action:'raise' }]);
  const p = tiny.snapshot('Novo');
  assert.equal(p.style, 'unknown');
  assert(Math.abs(p.bluffPriorAdjustment) <= 1);
}

// Professional river decision: top pair can fold versus a value-dense line on a draw-completing river.
{
  const state = {
    hero:[c('K','hearts'),c('Q','clubs')],
    board:[c('K','spades'),c('7','spades'),c('2','hearts'),c('4','clubs'),c('3','spades')],
    street:'river', pot:2000, actions:actionsFacing(1500,4500),
  };
  const events = [
    { actorName:'Reg', street:'flop', action:'bet', amount:300 },
    { actorName:'Reg', street:'turn', action:'bet', amount:700 },
    { actorName:'Reg', street:'river', action:'raise', amount:1500 },
  ];
  const report = buildProCoachReport({ state, events, actorName:'Reg', potBefore:1000 });
  assert.equal(report.decision, 'DESISTIR');
  assert.match(report.reason, /preço exige blefes demais/i);
  assert.equal(report.inferenceOnly, true);
}

// Professional river decision: bluff-catcher may call when price + line + missed draws support it.
{
  const state = {
    hero:[c('K','hearts'),c('Q','clubs')],
    board:[c('K','spades'),c('7','spades'),c('2','hearts'),c('4','clubs'),c('9','diamonds')],
    street:'river', pot:2500, actions:actionsFacing(1500,4500),
  };
  const events = [
    { actorName:'LAG', street:'flop', action:'check' },
    { actorName:'LAG', street:'turn', action:'check' },
    { actorName:'LAG', street:'river', action:'bet', amount:1500 },
  ];
  const report = buildProCoachReport({ state, events, actorName:'LAG', potBefore:1000, opponentStats:stats.snapshot('Maniac') });
  assert.equal(report.decision, 'PAGAR');
  assert.match(report.reason, /bluff-catcher/i);
  assert(report.rangeMix.bluffShare > report.math.breakEvenBluffCatch);
}

// Ace-high is not promoted to a hero-call just because the model sees bluff candidates.
{
  const state = {
    hero:[c('A','hearts'),c('Q','clubs')],
    board:[c('K','spades'),c('7','spades'),c('2','hearts'),c('4','clubs'),c('9','diamonds')],
    street:'river', pot:2500, actions:actionsFacing(1000,4000),
  };
  const events = [
    { actorName:'LAG', street:'flop', action:'check' },
    { actorName:'LAG', street:'turn', action:'check' },
    { actorName:'LAG', street:'river', action:'bet', amount:1500 },
  ];
  const report = buildProCoachReport({ state, events, actorName:'LAG', potBefore:1000 });
  assert.equal(report.decision, 'DESISTIR');
  assert.match(report.reason, /não é um bluff-catcher confiável/i);
}

// Strong made hands keep their value line instead of being scared by opponent modelling.
{
  const state = {
    hero:[c('7','diamonds'),c('7','clubs')],
    board:[c('K','spades'),c('7','hearts'),c('2','hearts'),c('4','clubs'),c('9','diamonds')],
    street:'river', pot:1800, actions:actionsFacing(700,2500),
  };
  const events = [
    { actorName:'Reg', street:'river', action:'bet', amount:700 },
  ];
  const report = buildProCoachReport({ state, events, actorName:'Reg', potBefore:1100 });
  assert.equal(report.decision, 'AUMENTAR');
}

// Preflop remains delegated to the fast preflop engine.
{
  const state = {
    hero:[c('A','spades'),c('A','hearts')], board:[], street:'preflop', pot:300,
    actions:[{type:'fold'},{type:'call',amount:100},{type:'raise',amount:400}],
  };
  const report = buildProCoachReport({ state });
  assert.equal(report.decision, 'AUMENTAR');
  assert.equal(report.coachLevel, 'pro-v1');
}

console.log('PRO COACH V1 calibration suite passed');
