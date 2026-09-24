import assert from 'node:assert/strict';
import {auditEquityMatrixReplicates} from '../src/math/equity-stability.js';

const hands=['AA','KK','72o'];
const a={matrix:{AA:{AA:.5,KK:.82,'72o':.88},KK:{AA:.18,KK:.5,'72o':.84},'72o':{AA:.12,KK:.16,'72o':.5}}};
const b={matrix:{AA:{AA:.5,KK:.818,'72o':.876},KK:{AA:.182,KK:.5,'72o':.837},'72o':{AA:.124,KK:.163,'72o':.5}}};
let audit=auditEquityMatrixReplicates({runs:[a,b],hands,maxMeanAbsDiff:.01,maxMaxAbsDiff:.01});
assert.equal(audit.stable,true,JSON.stringify(audit));
assert(audit.maxPairRange<=.01);

const noisy={matrix:{AA:{AA:.5,KK:.75,'72o':.88},KK:{AA:.25,KK:.5,'72o':.84},'72o':{AA:.12,KK:.16,'72o':.5}}};
audit=auditEquityMatrixReplicates({runs:[a,noisy],hands,maxMeanAbsDiff:.01,maxMaxAbsDiff:.04});
assert.equal(audit.stable,false);
assert.equal(audit.maxPair,'AA:KK');
assert(audit.maxPairRange>.04);
assert.throws(()=>auditEquityMatrixReplicates({runs:[a],hands}),/requires_2_runs/);

console.log('PASS — equity matrix replicate stability gate');
