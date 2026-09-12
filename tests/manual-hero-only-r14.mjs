import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const authority = fs.readFileSync(new URL('../src/vision/manual-hero-authority-r14.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../src/vision/manual-hero-entry-r14.js', import.meta.url), 'utf8');
const prefetch = fs.readFileSync(new URL('../src/vision/manual-hero-prefetch-r14.js', import.meta.url), 'utf8');
const consensus = fs.readFileSync(new URL('../src/vision/ai-decision-consensus-r14.js', import.meta.url), 'utf8');
const gate = fs.readFileSync(new URL('../src/solver/study-safety-gate-r14.js', import.meta.url), 'utf8');
const decisionApi = fs.readFileSync(new URL('../api/decision-state.js', import.meta.url), 'utf8');
const fullApi = fs.readFileSync(new URL('../api/full-state.js', import.meta.url), 'utf8');

assert.ok(
  bootstrap.indexOf('manual-hero-authority-r14') < bootstrap.indexOf('suit-scanner-runtime-r9'),
  'manual-only Hero guard must install before legacy visual Hero readers',
);
assert.match(authority, /manualOnly: true/);
assert.match(authority, /source !== 'manual'/);
assert.match(authority, /full\.manual\.hero = true/);
assert.match(authority, /Ignore AI Hero-card reads completely/);
assert.match(entry, /SUAS CARTAS · MANUAL/);
assert.match(entry, /prc:generation-change/);
assert.match(prefetch, /Mesa e ação já estavam pré-lidas/);
assert.match(prefetch, /rawStableFrames\) >= 2/);
assert.doesNotMatch(consensus, /cardKey\(d\.hero\)/, 'manual Hero must not reset table/action consensus');
assert.match(gate, /manualHeroReady/);
assert.match(gate, /requires: \['manual-hero','ai-decision-frame-consensus'\]/);
assert.match(decisionApi, /Hero hole cards are MANUAL-ONLY/);
assert.match(decisionApi, /hero: \[\]/);
assert.match(decisionApi, /heroConfidence: 0/);
assert.match(fullApi, /Hero hole cards are MANUAL-ONLY/);
assert.match(fullApi, /hero: \[\]/);
assert.match(fullApi, /heroConfidence: 0/);

console.log('MANUAL HERO ONLY R14 passed');
