import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const guard = fs.readFileSync(new URL('../src/vision/replay-only-guard-r14.js', import.meta.url), 'utf8');
const context = fs.readFileSync(new URL('../src/vision/replay-context-runtime-r14.js', import.meta.url), 'utf8');
const reviewRuntime = fs.readFileSync(new URL('../src/solver/replay-ai-review-runtime-r14.js', import.meta.url), 'utf8');
const reviewApi = fs.readFileSync(new URL('../api/coach-review-r14.js', import.meta.url), 'utf8');

assert.match(bootstrap, /replay-only-guard-r14/, 'R14 must install the uploaded-replay-only guard');
assert.ok(bootstrap.indexOf("await import('./main.js')") < bootstrap.indexOf('replay-only-guard-r14'), 'guard must override the legacy share handler after main boots');
assert.doesNotMatch(bootstrap, /replay-ai-review-runtime-r14/, 'inactive strategic review runtime must not boot');
assert.match(guard, /share\.disabled = true/, 'screen-share button must be disabled in R14');
assert.match(guard, /Replay por arquivo/, 'UI must make the file-only mode explicit');
assert.match(guard, /video-file/);
assert.match(guard, /image-file/);
assert.match(context, /await import\('\.\/ai-full-state-runtime-r14\.js'\)/, 'whole-frame AI table reconstruction must remain active inside replay context');
assert.match(reviewRuntime, /enabled: false/, 'experimental review runtime must remain inactive');
assert.match(reviewApi, /status\(410\)/, 'experimental review endpoint must remain disabled');

console.log('REPLAY ONLY R14 guard passed');
