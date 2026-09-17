import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const frozen = Object.freeze({
  'cards.ts':'a5462a502a62002a87524129c37cceeeb83b63b6',
  'board-texture.ts':'d4d10e95a0911f9c63a7eb8e7c5af66f57a57e18',
  'action-history.ts':'24450dac839cd4d989393964643fcf5cf7667726',
  'poker-state.ts':'68d8c113e2f14b49b33a37619cf90f64548646dc',
  'poker-math.ts':'51e817b7836b5db6ec5d38dde5b04d43477d41f1',
  'hand-eval.ts':'e7b6442f26e4f5aa19a4a9b93b4341ab59d40a88',
  'hand-strength.ts':'e4dfd36136c66c94e190c10551b8fb5072ad8ad7',
  'postflop.ts':'fe73a1be8976971a3bd346abc7539ee43bd8037f',
  'postflop-decision.ts':'287061486ae609ea4c5e2737352f2f648d64bff7',
  'postflop-policy-features.ts':'a2fed7a5181ab206aab6f6323c531af063891557',
  'postflop-policy.ts':'6609ae19574d12a458def0457d87f4f6b6aa62bd',
  'postflop-policy-decision.ts':'26ccaf61d61304336aa04cbc91fd2a09eb3af328',
  'raise-mapping.ts':'cbfb5e8b6a65aa682a54a982f636f95886049ddd',
});

const root=fileURLToPath(new URL('../src/strategy-v1/frozen-source/',import.meta.url));
const gitBlobSha=(bytes)=>crypto
  .createHash('sha1')
  .update(Buffer.from(`blob ${bytes.length}\0`,'utf8'))
  .update(bytes)
  .digest('hex');

assert.equal(Object.keys(frozen).length,13);
for(const [file,expected] of Object.entries(frozen)){
  const bytes=fs.readFileSync(root+file);
  assert.equal(gitBlobSha(bytes),expected,`${file} drifted from recovered frozen source`);
}

console.log('Policy V4 frozen-source integrity: 13/13 exact Git blobs');
