import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const manualEntry = fs.readFileSync(new URL('../src/vision/manual-hero-entry-r14.js', import.meta.url), 'utf8');
const continuity = fs.readFileSync(new URL('../src/vision/hero-continuity-guard-r14.js', import.meta.url), 'utf8');
const autoHero = fs.readFileSync(new URL('../src/vision/hero-refiner-runtime-r14.js', import.meta.url), 'utf8');
const crossSource = fs.readFileSync(new URL('../src/vision/ai-cross-source-consensus-r14.js', import.meta.url), 'utf8');
const potAuthority = fs.readFileSync(new URL('../src/vision/current-pot-authority-r14.js', import.meta.url), 'utf8');
const decisionCore = fs.readFileSync(new URL('../src/solver/decision-core-r14.js', import.meta.url), 'utf8');

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

// Current-turn pot authority: the main UI and strategic snapshot may never show
// two different pots. Stable local OCR can bypass the old full-frame monopoly,
// and one very strong current fast frame can move the pot forward only when the
// jump is plausible. Full-frame lag is advisory, never a strategic veto.
assert.match(bootstrap, /current-pot-authority-r14/);
assert.ok(bootstrap.indexOf('ai-decision-runtime-r14') < bootstrap.indexOf('current-pot-authority-r14'));
assert.match(potAuthority, /source === 'local'/);
assert.match(potAuthority, /deal\.commitPot/);
assert.match(potAuthority, /potConfidence\) < 0\.92/);
assert.match(potAuthority, /actionsConfidence\) < 0\.84/);
assert.match(potAuthority, /plausibleFastIncrease/);
assert.match(potAuthority, /current \* 12/);
assert.match(potAuthority, /maxAction \* 6/);
assert.match(potAuthority, /rejectedFastJumps/);
assert.match(potAuthority, /ai-decision-current/);
assert.match(potAuthority, /full\.pot = canonical/);
assert.match(potAuthority, /potSource = 'canonical-current'/);
assert.match(decisionCore, /fullPotConflict/);
assert.match(decisionCore, /fullBoardConflict/);
assert.match(decisionCore, /frame inteiro atrasado/);
assert.doesNotMatch(decisionCore, /return fail\('As duas fontes estão divergindo no pote atual\.'/);
assert.doesNotMatch(decisionCore, /return fail\('As duas fontes estão divergindo no board atual\.'/);

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
