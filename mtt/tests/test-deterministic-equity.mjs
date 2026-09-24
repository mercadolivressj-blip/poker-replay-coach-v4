import assert from 'node:assert/strict';
import {equityVsWeightedRange} from '../src/math/deterministic-equity.js';

const a=equityVsWeightedRange({heroCards:['As','Ah'],villainRange:{KK:1},iterations:2000,seed:'aa-v-kk'});
const b=equityVsWeightedRange({heroCards:['As','Ah'],villainRange:{KK:1},iterations:2000,seed:'aa-v-kk'});
assert.deepEqual(a,b);
assert(a.equity>.75 && a.equity<.9);
assert.equal(a.villainComboCount,6);

const riverWin=equityVsWeightedRange({heroCards:['As','Ah'],villainRange:{KK:1},board:['2c','3d','4h','7s','9c'],iterations:100,seed:'river'});
assert.equal(riverWin.equity,1);

const blocked=equityVsWeightedRange({heroCards:['As','Kd'],villainRange:{AKs:1,QQ:1},iterations:500,seed:'blocked'});
assert(blocked.villainComboCount>0);
assert(blocked.equity>=0 && blocked.equity<=1);

console.log('PASS — deterministic range equity regressions');
