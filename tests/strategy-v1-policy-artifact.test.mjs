import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { STRATEGY_V1_MANIFEST } from '../src/brain/strategy-manifest.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const post=STRATEGY_V1_MANIFEST.postflop;
const artifact=fileURLToPath(new URL('../'+post.expectedArtifactPath,import.meta.url));

assert.equal(post.id,'postflop-policy-v4');
assert.match(post.expectedModelSha256,/^[0-9a-f]{64}$/);
assert.equal(post.frozenSourceProjectId,'a4352431-0461-41cd-bebc-1e1e617a190c');

if(!fs.existsSync(artifact)){
  assert.equal(STRATEGY_V1_MANIFEST.policyComplete,false);
  assert.notEqual(post.status,'active');
  console.log('Policy V4 artifact gate: exact model not vendored; runtime correctly remains incomplete');
  process.exit(0);
}

const bytes=fs.readFileSync(artifact);
const sha=crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(
  sha,
  post.expectedModelSha256,
  'Policy V4 artifact exists but SHA-256 does not match frozen model — refuse parity claim'
);
assert.notEqual(
  STRATEGY_V1_MANIFEST.policyComplete,
  true,
  'Artifact hash alone is not enough: feature/model/decision-layer parity must be explicitly completed before policyComplete=true'
);
console.log('Policy V4 artifact gate: exact frozen SHA recovered; parity implementation still gated');
