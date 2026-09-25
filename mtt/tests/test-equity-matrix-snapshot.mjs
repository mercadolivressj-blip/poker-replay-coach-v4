import assert from 'node:assert/strict';
import {buildEquityMatrixSnapshot,verifyEquityMatrixSnapshot,validateEquityMatrix,snapshotSha256,equitySnapshotPayload} from '../src/math/equity-matrix-snapshot.js';

const hands=['KK','AA','72o'];
const matrix={AA:{AA:.5,KK:.82,'72o':.88},KK:{AA:.18,KK:.5,'72o':.84},'72o':{AA:.12,KK:.16,'72o':.5}};
const payload=equitySnapshotPayload({matrix,hands,seed:'seed-A',iterationsPerPair:5000,evaluatorVersion:'fast-v-test'});
const snap=buildEquityMatrixSnapshot({matrix,hands,seed:'seed-A',iterationsPerPair:5000,evaluatorVersion:'fast-v-test'});
assert.equal(snap.schema,'ssj-mtt-equity-matrix-v1');
assert.equal(snap.sha256.length,64);
assert.deepEqual(snap.hands,['72o','AA','KK']);
assert.equal(snapshotSha256(payload),snap.sha256);
assert.equal(verifyEquityMatrixSnapshot(snap).valid,true);

// Hash is canonical with respect to input hand ordering/object insertion order.
const matrix2={'72o':{'72o':.5,KK:.16,AA:.12},AA:{'72o':.88,KK:.82,AA:.5},KK:{'72o':.84,AA:.18,KK:.5}};
const snap2=buildEquityMatrixSnapshot({matrix:matrix2,hands:['72o','AA','KK'],seed:'seed-A',iterationsPerPair:5000,evaluatorVersion:'fast-v-test'});
assert.equal(snap.sha256,snap2.sha256);

const tampered=structuredClone(snap);tampered.matrix.AA.KK=.81;
const tamperedCheck=verifyEquityMatrixSnapshot(tampered);
assert.equal(tamperedCheck.valid,false);
assert(tamperedCheck.errors.some(x=>x==='sha256_mismatch'||x.startsWith('equity_snapshot_invalid:')));

const asym=structuredClone(matrix);asym.KK.AA=.21;
const check=validateEquityMatrix({matrix:asym,hands});
assert.equal(check.valid,false);
assert(check.errors.some(x=>x.startsWith('asymmetry:')));
assert.throws(()=>equitySnapshotPayload({matrix,hands,seed:'',iterationsPerPair:100}),/seed_missing/);
assert.throws(()=>equitySnapshotPayload({matrix,hands,seed:'x',iterationsPerPair:0}),/iterations_invalid/);

console.log('PASS — canonical equity snapshot / SHA256 / symmetry provenance regressions');
