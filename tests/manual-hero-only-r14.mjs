import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const authority = fs.readFileSync(new URL('../src/vision/manual-hero-authority-r14.js', import.meta.url), 'utf8');
const boundary = fs.readFileSync(new URL('../src/vision/manual-hero-boundary-r14.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../src/vision/manual-hero-entry-r14.js', import.meta.url), 'utf8');
const prefetch = fs.readFileSync(new URL('../src/vision/manual-hero-prefetch-r14.js', import.meta.url), 'utf8');
const consensus = fs.readFileSync(new URL('../src/vision/ai-decision-consensus-r14.js', import.meta.url), 'utf8');
const gate = fs.readFileSync(new URL('../src/solver/study-safety-gate-r14.js', import.meta.url), 'utf8');
const decisionApi = fs.readFileSync(new URL('../api/decision-state.js', import.meta.url), 'utf8');
const fullApi = fs.readFileSync(new URL('../api/full-state.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/core/decision-store.js', import.meta.url), 'utf8');

assert.ok(
  bootstrap.indexOf('manual-hero-authority-r14') < bootstrap.indexOf('suit-scanner-runtime-r9'),
  'manual-only Hero guard must install before legacy visual Hero readers',
);
assert.doesNotMatch(bootstrap, /hero-authority-runtime-r11/, 'manual-only R14 must not boot the legacy automatic Hero authority');
assert.match(bootstrap, /manual-hero-boundary-r14/);
assert.match(authority, /manualOnly: true/);
assert.match(authority, /source !== 'manual'/);
assert.match(authority, /full\.manual\.hero = true/);
assert.match(authority, /Ignore AI Hero-card reads completely/);
assert.match(boundary, /r14-manual-hero-confirms-redeal/);
assert.match(boundary, /visualBoardHits\) >= 3/);
assert.match(boundary, /rebasedBoundary/);
assert.match(entry, /SUAS CARTAS · MANUAL/);
assert.match(entry, /prc:generation-change/);
assert.match(prefetch, /Mesa e ação já estavam pré-lidas/);
assert.match(prefetch, /rawStableFrames\) >= 2/);
assert.doesNotMatch(consensus, /cardKey\(d\.hero\)/, 'manual Hero must not reset table/action consensus');
assert.match(gate, /manualHeroReady/);
assert.match(gate, /physical-board-or-fast-identity/);
assert.match(gate, /fresh-table-context/);
assert.match(gate, /rawStableFrames >= 2/);
assert.match(gate, /physicalBoardConsensus: 3/);
assert.match(gate, /fastBoardIdentityConsensus: 2/);
assert.match(gate, /tableContextMaxAgeMs: 8500/);
assert.match(store, /clockStartsAfterManualHero: true/);
assert.match(store, /manualHeroReadyForDecision/);
assert.match(decisionApi, /Hero hole cards are MANUAL-ONLY/);
assert.match(decisionApi, /hero: \[\]/);
assert.match(decisionApi, /heroConfidence: 0/);
assert.match(fullApi, /Hero hole cards are MANUAL-ONLY/);
assert.match(fullApi, /hero: \[\]/);
assert.match(fullApi, /heroConfidence: 0/);

console.log('MANUAL HERO ONLY R14 passed');
