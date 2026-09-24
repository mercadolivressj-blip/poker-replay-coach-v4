import assert from 'node:assert/strict';
import {compatibleComboCount,equityClassVsClass} from '../src/math/class-equity.js';
import {shoveActionEV,bbCallActionEV,solveHuPushFold} from '../src/solver/hu-pushfold-cfr.js';

assert.equal(compatibleComboCount('AA','AA'),6);
assert.equal(compatibleComboCount('AA','AKs'),12);
assert(compatibleComboCount('AKo','AKo')>0);

const sampled=equityClassVsClass('AA','72o',{iterations:1200,seed:'v05-regression'});
assert(sampled.equity>0.75&&sampled.equity<0.95,`AA equity sanity failed ${sampled.equity}`);

const hands=['AA','72o'];
const M={AA:{AA:.5,'72o':.82},'72o':{AA:.18,'72o':.5}};
assert.equal(shoveActionEV('AA',{stackBB:10,callStrategy:{AA:0,'72o':0},equityMatrix:M,hands}),1);
assert(shoveActionEV('AA',{stackBB:10,callStrategy:{AA:1,'72o':1},equityMatrix:M,hands})>-0.5);
assert(shoveActionEV('72o',{stackBB:10,callStrategy:{AA:1,'72o':1},equityMatrix:M,hands})<0);
const bb=bbCallActionEV('AA',{stackBB:10,shoveStrategy:{AA:1,'72o':1},equityMatrix:M,hands});
assert(bb.callEV>-1);

const solved=solveHuPushFold({stackBB:10,equityMatrix:M,hands,iterations:10000,burnIn:1000});
for(const x of Object.values(solved.shoveStrategy))assert(x>=0&&x<=1);
for(const x of Object.values(solved.callStrategy))assert(x>=0&&x<=1);
assert(Number.isFinite(solved.nashConv));
assert(solved.nashConv<0.05,`toy push-fold did not converge enough: ${solved.nashConv}`);
console.log('PASS — push-fold blocker/equity/CFR smoke tests',JSON.stringify({nashConv:solved.nashConv,shove:solved.shoveStrategy,call:solved.callStrategy}));
