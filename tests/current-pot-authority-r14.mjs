import assert from 'node:assert/strict';
import fs from 'node:fs';

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const potAuthority = fs.readFileSync(new URL('../src/vision/current-pot-authority-r14.js', import.meta.url), 'utf8');
const decisionCore = fs.readFileSync(new URL('../src/solver/decision-core-r14.js', import.meta.url), 'utf8');
const transaction = fs.readFileSync(new URL('../src/vision/state-transaction-runtime-r14.js', import.meta.url), 'utf8');

assert.match(bootstrap, /current-pot-authority-r14/);
assert.ok(
  bootstrap.indexOf('ai-decision-runtime-r14') < bootstrap.indexOf('current-pot-authority-r14'),
  'current pot authority must observe the fast current-turn lane',
);

// Local stable OCR must be able to bypass the old full-frame monopoly through
// the arbiter, and one exceptionally strong current fast frame may move the pot
// forward before 2/2 when the jump is economically plausible.
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

// The older transaction guard may still contain its historical full-frame block;
// the authority module intentionally bypasses it only through DealSnapshotArbiter.
assert.match(transaction, /fullPotBlocksDuringHeroTurn/);

// Full-frame pot/board disagreements are secondary evidence now. They may lower
// confidence but can no longer veto a coherent current-turn core.
assert.match(decisionCore, /fullPotConflict/);
assert.match(decisionCore, /fullBoardConflict/);
assert.match(decisionCore, /frame inteiro atrasado/);
assert.doesNotMatch(decisionCore, /return fail\('As duas fontes estão divergindo no pote atual\.'/);
assert.doesNotMatch(decisionCore, /return fail\('As duas fontes estão divergindo no board atual\.'/);

console.log('CURRENT POT AUTHORITY R14 passed');
