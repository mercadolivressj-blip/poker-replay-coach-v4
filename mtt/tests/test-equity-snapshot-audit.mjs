import assert from 'node:assert/strict';
import {buildEquityMatrixSnapshot} from '../src/math/equity-matrix-snapshot.js';
import {auditEquitySnapshots} from '../src/math/equity-snapshot-audit.js';

const hands=['AA','KK','72o'];
const m1={AA:{AA:.5,KK:.82,'72o':.88},KK:{AA:.18,KK:.5,'72o':.84},'72o':{AA:.12,KK:.16,'72o':.5}};
const m2={AA:{AA:.5,KK:.818,'72o':.876},KK:{AA:.182,KK:.5,'72o':.837},'72o':{AA:.124,KK:.163,'72o':.5}};
const a=buildEquityMatrixSnapshot({matrix:m1,hands,seed:'prod-A',iterationsPerPair:5000,evaluatorVersion:'fast-v-test'});
const b=buildEquityMatrixSnapshot({matrix:m2,hands,seed:'prod-B',iterationsPerPair:5000,evaluatorVersion:'fast-v-test'});
let report=auditEquitySnapshots({snapshots:[a,b],maxMeanAbsDiff:.01,maxMaxAbsDiff:.01});
assert.equal(report.stable,true,JSON.stringify(report));
assert.deepEqual(report.snapshotShas,[a.sha256,b.sha256]);
assert.deepEqual(report.seeds,['prod-A','prod-B']);

const noisy={AA:{AA:.5,KK:.75,'72o':.88},KK:{AA:.25,KK:.5,'72o':.84},'72o':{AA:.12,KK:.16,'72o':.5}};
const c=buildEquityMatrixSnapshot({matrix:noisy,hands,seed:'prod-C',iterationsPerPair:5000,evaluatorVersion:'fast-v-test'});
report=auditEquitySnapshots({snapshots:[a,c],maxMeanAbsDiff:.01,maxMaxAbsDiff:.04});
assert.equal(report.stable,false);
assert.equal(report.stability.maxPair,'AA:KK');

const sameSeed=buildEquityMatrixSnapshot({matrix:m2,hands,seed:'prod-A',iterationsPerPair:5000,evaluatorVersion:'fast-v-test'});
assert.throws(()=>auditEquitySnapshots({snapshots:[a,sameSeed]}),/seed_not_independent/);
const differentIters=buildEquityMatrixSnapshot({matrix:m2,hands,seed:'prod-D',iterationsPerPair:4000,evaluatorVersion:'fast-v-test'});
assert.throws(()=>auditEquitySnapshots({snapshots:[a,differentIters]}),/iterations_mismatch/);
const tampered=structuredClone(b);tampered.matrix.AA.KK=.7;
assert.throws(()=>auditEquitySnapshots({snapshots:[a,tampered]}),/invalid_snapshot/);

console.log('PASS — production equity snapshot cross-seed audit regressions');
