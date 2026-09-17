import assert from 'node:assert/strict';
import handler from '../api/brain.js';
import { decideBrain } from '../src/brain/decision.js';
import { estimatedRiskPremiumPct, mttContext, tournamentPhase } from '../src/brain/mtt-context.js';
import { STRATEGY_V1_MANIFEST } from '../src/brain/strategy-manifest.js';

assert.equal(STRATEGY_V1_MANIFEST.mtt.status,'approximation-only-not-certified');
assert.equal(STRATEGY_V1_MANIFEST.mtt.chartCertified,false);
assert.equal(STRATEGY_V1_MANIFEST.mtt.icmCertified,false);
assert.equal(STRATEGY_V1_MANIFEST.mtt.solverCertified,false);

assert.equal(tournamentPhase({playersRemaining:101,paidPlaces:100}),'bubble');
assert.equal(estimatedRiskPremiumPct({playersRemaining:101,paidPlaces:100}),8);

const heuristic=mttContext(
  {heroStack:'0.24',effectiveStack:'0.24',blinds:'0.01/0.02'},
  {playersRemaining:101,paidPlaces:100},
);
assert.equal(heuristic.depthBB,12);
assert.equal(heuristic.phase,'bubble');
assert.equal(heuristic.riskPremiumPct,8);
assert.equal(heuristic.riskPremiumSource,'phase-heuristic');
assert.equal(heuristic.certification,'approximation-only');
assert.equal(heuristic.icmCertified,false);
assert.equal(heuristic.solverCertified,false);
assert.equal(heuristic.confidence,'heuristic-context');

const explicit=mttContext(
  {heroStack:'0.24',effectiveStack:'0.24',blinds:'0.01/0.02'},
  {playersRemaining:101,paidPlaces:100,icmRiskPremiumPct:12.5},
);
assert.equal(explicit.riskPremiumPct,12.5);
assert.equal(explicit.riskPremiumSource,'explicit-external-context');
assert.equal(explicit.confidence,'explicit-context');
// An externally supplied number has clearer provenance, but this module still
// does not certify its upstream calculator or turn the Brain into an ICM solver.
assert.equal(explicit.icmCertified,false);
assert.equal(explicit.solverCertified,false);

const short={
  version:'vision-v1',
  heroCards:['Ah','Kd'],heroPresence:'present',board:[],boardPresence:'absent',
  pot:'0.03',toCall:null,legalActions:['FOLD','ALLIN'],
  players:6,activePlayers:6,heroPosition:'BTN',
  heroStack:'0.12',effectiveStack:'0.12',blinds:'0.01/0.02',
  seats:[],actionHistory:[],confidence:.99,readerModel:'test',capturedAt:1,
};
const r=decideBrain(short,{format:'mtt'});
assert.equal(r.actionCode,'ALLIN');
assert.match(r.engine,/APROXIMAÇÃO/);
assert.doesNotMatch(r.engine,/SOLVER|ICM/i);
assert.equal(r.certification,'approximation-only');
assert.equal(r.icmCertified,false);
assert.equal(r.solverCertified,false);
assert.equal(r.strategyStatus.mtt,'approximation-only-not-certified');

const res={
  statusCode:200,headers:{},body:null,
  setHeader(k,v){this.headers[k]=v;},
  end(v){this.body=v?JSON.parse(v):null;return this;},
};
await handler({method:'GET',body:null},res);
assert.equal(res.statusCode,200);
assert.equal(res.body.strategyStatus.mtt,'approximation-only-not-certified');
assert.equal(res.body.strategyStatus.mttIcmCertified,false);

console.log('MTT/ICM audit gates: approximation provenance explicit; no solver/ICM certification claim');
