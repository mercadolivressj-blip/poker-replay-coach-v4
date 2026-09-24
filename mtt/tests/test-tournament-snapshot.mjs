import assert from 'node:assert/strict';
import {normalizeBlindLevel,stackProjection,blindPressure} from '../src/core/blind-pressure.js';
import {normalizeTableState,effectiveStacksByOpponent} from '../src/core/table-state.js';
import {buildTournamentSnapshot} from '../src/core/tournament-snapshot.js';

const level=normalizeBlindLevel({smallBlind:40000,bigBlind:80000,ante:10000,nextSmallBlind:50000,nextBigBlind:100000,nextAnte:12500,secondsToNextLevel:55,level:18});
const projection=stackProjection(1652687,level);
assert(Math.abs(projection.currentBB-20.6585875)<1e-9);
assert(Math.abs(projection.nextLevelBB-16.52687)<1e-9);
const pressure=blindPressure({...level,heroStack:1652687});
assert.equal(pressure.timeWindow,'IMMINENT');
assert.equal(pressure.projectedBucketShift.from,'17-25');
assert.equal(pressure.projectedBucketShift.to,'12-17');
assert.equal(pressure.projectedBucketShift.changes,true);

const table=normalizeTableState({bigBlind:1000,nextBigBlind:1200,seats:[
 {seat:1,position:'UTG',stack:40000},
 {seat:2,position:'HJ',stack:18000},
 {seat:3,position:'BTN',stack:24000,hero:true},
 {seat:4,position:'SB',stack:12000},
 {seat:5,position:'BB',stack:50000}
]});
assert.equal(table.occupiedCount,5);
assert.equal(table.hero.stackBB,24);
assert.equal(table.heroTableRank,3);
const eff=effectiveStacksByOpponent(table);
assert.equal(eff.find(x=>x.position==='SB').effectiveBB,12);
assert.equal(eff.find(x=>x.position==='BB').effectiveBB,24);

const snap=buildTournamentSnapshot({
 game:'NLHE',format:'MTT',tableSize:9,speed:'regular',bountyType:'none',
 smallBlind:500,bigBlind:1000,ante:125,anteType:'individual',
 nextSmallBlind:600,nextBigBlind:1200,nextAnte:150,secondsToNextLevel:90,level:12,
 heroPosition:'BTN',heroStack:24000,villainStack:30000,pot:2500,toCall:0,
 entrants:499,remaining:300,paidSpots:71,legalActions:['FOLD','CALL','RAISE'],
 seats:[
  {seat:1,position:'UTG',stack:50000},{seat:2,position:'UTG1',stack:32000},{seat:3,position:'MP',stack:28000},
  {seat:4,position:'LJ',stack:18000},{seat:5,position:'HJ',stack:21000},{seat:6,position:'CO',stack:27000},
  {seat:7,position:'BTN',stack:24000,hero:true},{seat:8,position:'SB',stack:16000},{seat:9,position:'BB',stack:35000}
 ]
});
assert.equal(snap.ready,true);
assert.equal(snap.routingKey,'nlhe|mtt|9max|regular|none');
assert.equal(snap.table.occupiedCount,9);
assert.equal(snap.effectiveByOpponent.length,8);
assert.equal(snap.decisionModeRequirement.preferred,'cEV');

const bubble=buildTournamentSnapshot({
 game:'NLHE',format:'MTT',tableSize:9,speed:'regular',bountyType:'none',
 smallBlind:500,bigBlind:1000,ante:125,heroPosition:'BTN',heroStack:24000,villainStack:30000,
 pot:2500,toCall:0,entrants:499,remaining:76,paidSpots:71,legalActions:['FOLD','CALL','RAISE'],
 payouts:[100,80,60,50,40,30,20,10,5],
 seats:[{seat:1,position:'BTN',stack:24000,hero:true},{seat:2,position:'BB',stack:30000}]
});
assert.equal(bubble.state.phase,'BUBBLE');
assert.equal(bubble.decisionModeRequirement.preferred,'ICM');
assert.equal(bubble.decisionModeRequirement.requiredForCertification,true);
assert.equal(bubble.decisionModeRequirement.inputsReady,true);

console.log('PASS — MTT V0.2 tournament snapshot regressions');
