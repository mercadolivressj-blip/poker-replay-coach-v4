import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const authority = fs.readFileSync(new URL('../src/vision/manual-hero-authority-r14.js', import.meta.url), 'utf8');
const boundary = fs.readFileSync(new URL('../src/vision/manual-hero-boundary-r14.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../src/vision/manual-hero-entry-r14.js', import.meta.url), 'utf8');
const autoHero = fs.readFileSync(new URL('../src/vision/hero-refiner-runtime-r14.js', import.meta.url), 'utf8');
const prefetch = fs.readFileSync(new URL('../src/vision/manual-hero-prefetch-r14.js', import.meta.url), 'utf8');
const consensus = fs.readFileSync(new URL('../src/vision/ai-decision-consensus-r14.js', import.meta.url), 'utf8');
const decisionApi = fs.readFileSync(new URL('../api/decision-state.js', import.meta.url), 'utf8');
const fullApi = fs.readFileSync(new URL('../api/full-state.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/core/decision-store.js', import.meta.url), 'utf8');

assert.ok(
  bootstrap.indexOf('manual-hero-authority-r14') < bootstrap.indexOf('hero-refiner-runtime-r14'),
  'Hero authority must install before the local automatic Hero reader',
);
assert.doesNotMatch(bootstrap, /hero-authority-runtime-r11/, 'R14 must not boot the legacy automatic Hero authority');
assert.match(bootstrap, /hero-refiner-runtime-r14/);
assert.match(bootstrap, /manual-hero-boundary-r14/);
assert.match(authority, /manualOnly: true/);
assert.match(authority, /localReplayAuto: true/);
assert.match(authority, /source === 'replay-auto'/);
assert.match(authority, /source === 'manual'/);
assert.match(authority, /video-file/);
assert.match(authority, /image-file/);
assert.match(authority, /screenReplayReady === true/);
assert.match(authority, /sourceKind === 'screen-replay'/);
assert.match(authority, /fileReplay \|\| confirmedSharedReplay/);
assert.match(authority, /full\.manual\.hero = true/);

assert.match(autoHero, /BoardCardConsensus\(\{ slots: 2/);
assert.match(autoHero, /candidateMinHits: 4/);
assert.match(autoHero, /pairHits < 2/);
assert.match(autoHero, /locateHeroCardSlots/);
assert.match(autoHero, /classifyPokerStarsSuitPixels/);
assert.match(autoHero, /new OcrService\(\)/);
assert.match(autoHero, /ocr\.readRank/);
assert.match(autoHero, /source: 'replay-auto'/);
assert.match(autoHero, /replayOnly: true/);
assert.match(autoHero, /video-file/);
assert.match(autoHero, /image-file/);
assert.match(autoHero, /screenReplayReady === true/);
assert.match(autoHero, /sourceKind === 'screen-replay'/);
assert.match(autoHero, /layout\?\.heroSuitSlots/);

assert.doesNotMatch(boundary, /machine\.newHand/);
assert.match(boundary, /stable-dealer-proof-owns-boundary/);
assert.match(entry, /autoReaderOwnsCurrentAttempt/);
assert.match(entry, /prc:hero-auto-confirmed/);
assert.match(entry, /SUAS CARTAS · \$\{mode\}/);
assert.match(entry, /prc:generation-change/);
assert.match(entry, /Manual correction is user-initiated only/);
assert.doesNotMatch(entry, /auto\?\.fallbackReady !== true/);
assert.doesNotMatch(entry, /fallbackReady[^\n]*metric\.click/);
assert.match(prefetch, /Mesa e ação já estavam pré-lidas/);
assert.match(prefetch, /rawStableFrames\) >= 2/);
assert.doesNotMatch(consensus, /cardKey\(d\.hero\)/, 'local/manual Hero must not reset public table/action consensus');
assert.match(store, /clockStartsAfterManualHero: true/);
assert.match(store, /manualHeroReadyForDecision/);

// Remote AI endpoints remain public-state-only. Automatic Hero is local pixel
// analysis of a confirmed replay source; the API still never reads hole cards.
assert.match(decisionApi, /Hero hole cards are MANUAL-ONLY/);
assert.match(decisionApi, /hero:\s*\[\]/);
assert.match(decisionApi, /heroConfidence:\s*0/);
assert.match(fullApi, /Hero hole cards are MANUAL-ONLY/);
assert.match(fullApi, /hero:\s*\[\]/);
assert.match(fullApi, /heroConfidence:\s*0/);

console.log('HERO AUTHORITY R14 passed');
