import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const manualEntry = fs.readFileSync(new URL('../src/vision/manual-hero-entry-r14.js', import.meta.url), 'utf8');
const continuity = fs.readFileSync(new URL('../src/vision/hero-continuity-guard-r14.js', import.meta.url), 'utf8');
const autoHero = fs.readFileSync(new URL('../src/vision/hero-refiner-runtime-r14.js', import.meta.url), 'utf8');
const crossSource = fs.readFileSync(new URL('../src/vision/ai-cross-source-consensus-r14.js', import.meta.url), 'utf8');

// Mid-hand popup regression: once Hero was entered or auto-confirmed, polling may
// not reopen the editor unless a genuinely new generation is armed.
assert.match(manualEntry, /lastHeroAppliedHandId/);
assert.match(manualEntry, /armedPromptHandId/);
assert.match(manualEntry, /confirmedGeneration/);
assert.match(manualEntry, /physicalHeroReadyForPrompt/);
assert.match(manualEntry, /lastHeroAppliedHandId > 0 && armedPromptHandId !== handId/);
assert.match(manualEntry, /prc:hero-auto-confirmed/);
assert.match(manualEntry, /autoReaderOwnsCurrentAttempt/);

// All post-lock boundaries now use one proof: the dealer/button must actually
// move and be observed twice. A pot fall or visual card gap alone is diagnostic.
assert.match(continuity, /DEALER_CONFIRM_HITS = 2/);
assert.match(continuity, /dealerChanged && pending\.dealerHits >= DEALER_CONFIRM_HITS/);
assert.match(continuity, /potResetAccepted: false/);
assert.match(continuity, /blockedPotOnlyBoundaries/);
assert.match(continuity, /board-boundary-awaiting-stable-dealer-move/);
assert.match(continuity, /preflop-hero-boundary-awaiting-stable-dealer-move/);
assert.match(continuity, /board-boundary-confirmed-dealer-moved-2of2/);
assert.match(continuity, /preflop-hero-boundary-confirmed-dealer-moved-2of2/);

// Hero local reader uses board-grade temporal consensus, then a final pair-level
// confirmation before authority can lock the two complete cards.
assert.match(autoHero, /BoardCardConsensus\(\{ slots: 2/);
assert.match(autoHero, /SuitConsensus/);
assert.match(autoHero, /candidateMinHits: 4/);
assert.match(autoHero, /pairHits < 2/);
assert.match(autoHero, /duplicatePhysicalCard/);
assert.match(autoHero, /source: 'replay-auto'/);

// Existing cross-source public-state latency optimization stays intact.
assert.match(crossSource, /full\.trusted === true/);
assert.match(crossSource, /sameActionTypes\(fastActions, localActions\)/);
assert.match(crossSource, /fastBoardOk/);
assert.match(crossSource, /fullBoardOk/);
assert.match(crossSource, /fastPotOk/);
assert.match(crossSource, /fullPotOk/);
assert.match(crossSource, /rawStableFrames = Math\.max\(2/);
assert.match(crossSource, /stableDecisionFrames = Math\.max\(2/);

assert.doesNotMatch(bootstrap, /hero-redeal-proof-guard-r14/);
assert.match(bootstrap, /hero-continuity-guard-r14/);
assert.match(bootstrap, /hero-refiner-runtime-r14/);
assert.match(bootstrap, /ai-cross-source-consensus-r14/);

console.log('R14 latest guards passed');
