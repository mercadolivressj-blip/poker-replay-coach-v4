import assert from 'node:assert/strict';
import {normalizePushFoldGame,sbShoveEVIncrement,bbCallEVIncrement,solvePushFoldGame,verifyPushFoldProfile} from '../src/solver/pushfold-game.js';
import {solveHuPushFold} from '../src/solver/hu-pushfold-cfr.js';

const hands=['AA','72o'];
const M={AA:{AA:.5,'72o':.82},'72o':{AA:.18,'72o':.5}};
const standard=normalizePushFoldGame({effectiveStackBB:10});
assert.equal(standard.potBeforeBB,1.5);
assert.equal(standard.showdownPotBB,20);
assert.equal(standard.sbFoldGainBB,1);

const noCalls={AA:0,'72o':0};
assert.equal(sbShoveEVIncrement('AA',{game:standard,callStrategy:noCalls,equityMatrix:M,hands}),1);
const withAntes=normalizePushFoldGame({effectiveStackBB:10,heroForcedBB:.625,villainForcedBB:1.125,deadMoneyBB:.75});
assert(withAntes.sbFoldGainBB>standard.sbFoldGainBB);
assert(sbShoveEVIncrement('72o',{game:withAntes,callStrategy:noCalls,equityMatrix:M,hands})>sbShoveEVIncrement('72o',{game:standard,callStrategy:noCalls,equityMatrix:M,hands}));

const allShove={AA:1,'72o':1};
const aaCall=bbCallEVIncrement('AA',{game:standard,shoveStrategy:allShove,equityMatrix:M,hands});
assert(aaCall.callEV>0);

const solved=solvePushFoldGame({game:standard,equityMatrix:M,hands,iterations:12000,burnIn:1000});
assert(solved.nashConv<0.05,`generic solver did not converge: ${solved.nashConv}`);
const verified=verifyPushFoldProfile({game:standard,shoveStrategy:solved.shoveStrategy,callStrategy:solved.callStrategy,equityMatrix:M,hands});
assert(Math.abs(verified.nashConv-solved.nashConv)<1e-12);

// Standard 0.5/1/no-ante game must be strategically equivalent to the legacy formulation.
const legacy=solveHuPushFold({stackBB:10,equityMatrix:M,hands,iterations:12000,burnIn:1000});
for(const h of hands){
 assert(Math.abs(solved.shoveStrategy[h]-legacy.shoveStrategy[h])<0.03,`shove mismatch ${h}`);
 assert(Math.abs(solved.callStrategy[h]-legacy.callStrategy[h])<0.03,`call mismatch ${h}`);
}
console.log('PASS — generic push-fold game / dead-money / legacy-equivalence regressions',JSON.stringify({nashConv:solved.nashConv}));
