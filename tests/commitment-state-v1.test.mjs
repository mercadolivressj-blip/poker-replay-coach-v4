import assert from 'node:assert/strict';
import { resolveSeatCommitmentV1, resolveCommitmentMapV1 } from '../src/core/commitment-state.js';

assert.deepEqual(
  resolveSeatCommitmentV1({ocrValue:.06,persistedCommitment:.02,streetStartStack:2,currentStack:1.9}),
  {value:.06,source:'fixed-roi-numeric'}
);
assert.deepEqual(
  resolveSeatCommitmentV1({ocrValue:null,persistedCommitment:.06,streetStartStack:2,currentStack:1.88}),
  {value:.06,source:'seat-ledger-persisted'}
);
assert.deepEqual(
  resolveSeatCommitmentV1({ocrValue:null,persistedCommitment:null,streetStartStack:2,currentStack:1.98}),
  {value:.02,source:'street-stack-delta'}
);
assert.equal(resolveSeatCommitmentV1({streetStartStack:1.9,currentStack:2.1}).value,null);

const rows=resolveCommitmentMapV1({
  hero:{cardsPresent:true,commitment:null,stack:1.98},
  lb:{cardsPresent:true,commitment:null,stack:1.91},
  top:{cardsPresent:true,commitment:.06,stack:3.85},
},{
  persistedCommitments:{lb:.06},
  streetStartStacks:{hero:2.00,lb:1.97},
});
assert.equal(rows.hero.commitment,.02);
assert.equal(rows.hero.commitmentSource,'street-stack-delta');
assert.equal(rows.lb.commitment,.06);
assert.equal(rows.lb.commitmentSource,'seat-ledger-persisted');
assert.equal(rows.top.commitment,.06);
assert.equal(rows.top.commitmentSource,'fixed-roi-numeric');

console.log('commitment-state-v1 ok');
