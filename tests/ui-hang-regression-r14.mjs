import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const isolation = fs.readFileSync(new URL('../src/solver/legacy-strategy-ui-isolation-r14.js', import.meta.url), 'utf8');
const single = fs.readFileSync(new URL('../src/solver/single-decision-ui-r14.js', import.meta.url), 'utf8');

const isolateAt = bootstrap.indexOf("legacy-strategy-ui-isolation-r14.js");
const mainAt = bootstrap.indexOf("await import('./main.js')");
const restoreAt = bootstrap.indexOf('restoreR14DecisionUi');
assert.ok(isolateAt >= 0 && mainAt >= 0 && restoreAt >= 0, 'bootstrap must isolate, import main, then restore');
assert.ok(isolateAt < mainAt, 'legacy recommendation DOM must be isolated before main.js captures refs');
assert.ok(mainAt < restoreAt, 'real decision DOM must be restored only after main.js captures dummy refs');

for (const id of ['decisionText','decisionReason','decisionDetails','confidence']) {
  assert.match(isolation, new RegExp(id));
}
assert.match(isolation, /legacyStrategySinkR14/);
assert.match(isolation, /dummy\.remove\(\)/);
assert.match(isolation, /node\.id = id/);

assert.doesNotMatch(single, /new MutationObserver/);
assert.doesNotMatch(single, /observer\.observe/);
assert.match(single, /mutationObserver: false/);
assert.match(single, /legacyUiIsolated: true/);
assert.match(single, /setInterval\(render, 160\)/);

console.log('UI HANG REGRESSION R14 passed');
