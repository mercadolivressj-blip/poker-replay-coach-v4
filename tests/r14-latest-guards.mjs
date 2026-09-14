import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const manualEntry = fs.readFileSync(new URL('../src/vision/manual-hero-entry-r14.js', import.meta.url), 'utf8');
const redealProof = fs.readFileSync(new URL('../src/vision/hero-redeal-proof-guard-r14.js', import.meta.url), 'utf8');
const crossSource = fs.readFileSync(new URL('../src/vision/ai-cross-source-consensus-r14.js', import.meta.url), 'utf8');

// Mid-hand manual popup regression: once Hero was entered, the polling loop may
// not reopen the editor unless a confirmed new generation explicitly arms it.
assert.match(manualEntry, /lastHeroAppliedHandId/);
assert.match(manualEntry, /armedPromptHandId/);
assert.match(manualEntry, /confirmedGeneration/);
assert.match(manualEntry, /physicalHeroReadyForPrompt/);
assert.match(manualEntry, /lastHeroAppliedHandId > 0 && armedPromptHandId !== handId/);
assert.match(manualEntry, /blocked:\$\{reason \|\| 'unknown'\}/);

// Preflop false-redeal regression: pot OCR/reset alone is never enough to erase
// manual Hero. Dealer/button must move and repeat consistently twice.
assert.match(redealProof, /blocked-preflop-redeal-without-dealer-move/);
assert.match(redealProof, /dealer-move-confirming-1of2/);
assert.match(redealProof, /dealer-move-confirmed-2of2/);
assert.match(redealProof, /candidateHits < 2/);
assert.match(redealProof, /evidence\?\.dealerChanged === true/);

// Decision latency regression: a single strong fast frame can be promoted only
// when a trusted full frame agrees on board/pot and local legal actions agree.
assert.match(crossSource, /full\.trusted === true/);
assert.match(crossSource, /sameActionTypes\(fastActions, localActions\)/);
assert.match(crossSource, /fastBoardOk/);
assert.match(crossSource, /fullBoardOk/);
assert.match(crossSource, /fastPotOk/);
assert.match(crossSource, /fullPotOk/);
assert.match(crossSource, /rawStableFrames = Math\.max\(2/);
assert.match(crossSource, /stableDecisionFrames = Math\.max\(2/);
assert.match(crossSource, /Consenso cruzado/);

assert.match(bootstrap, /hero-redeal-proof-guard-r14/);
assert.match(bootstrap, /ai-cross-source-consensus-r14/);

console.log('R14 latest guards passed');
