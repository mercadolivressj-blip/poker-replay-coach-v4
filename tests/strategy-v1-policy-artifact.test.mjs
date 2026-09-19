import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { POSTFLOP_POLICY_V4_RAW, POSTFLOP_POLICY_V4_MODEL } from '../src/strategy-v1/postflop-policy-model.js';
import { STRATEGY_V1_MANIFEST } from '../src/brain/strategy-manifest.js';

const post=STRATEGY_V1_MANIFEST.postflop;
assert.equal(post.id,'postflop-policy-v4');
assert.equal(post.status,'active-frozen-policy-v4');
assert.equal(post.frozenSourceProjectId,'a4352431-0461-41cd-bebc-1e1e617a190c');
assert.equal(post.frozenSourceCommit,'3efde306fbb1dda38584cb8ffee0c2245b6231f4');

const byteSha=crypto.createHash('sha256').update(Buffer.from(POSTFLOP_POLICY_V4_RAW,'utf8')).digest('hex');
assert.equal(byteSha,post.expectedArtifactByteSha256,'lossless recovered artifact byte SHA changed');
assert.equal(POSTFLOP_POLICY_V4_MODEL.version,'postflop-policy-v4');
assert.equal(POSTFLOP_POLICY_V4_MODEL.hash,post.expectedModelSha256,'embedded certified model hash changed');
assert.equal(POSTFLOP_POLICY_V4_MODEL.features.length,74);
assert.equal(POSTFLOP_POLICY_V4_MODEL.trees.length,400);
assert.deepEqual(POSTFLOP_POLICY_V4_MODEL.classes,['CHECK','BET','CALL','FOLD','RAISE']);
assert.equal(STRATEGY_V1_MANIFEST.policyComplete,true,'active Policy V4 must remain fully parity-gated');
assert.equal(STRATEGY_V1_MANIFEST.decisionLayer.status,'active-final-frozen-v4');

console.log('Policy V4 artifact gate: exact frozen artifact active with runtime parity complete');
