import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DealSnapshotArbiter } from '../src/core/deal-snapshot-arbiter-r14.js';

const api = fs.readFileSync(new URL('../api/full-state.js', import.meta.url), 'utf8');
const gemini = fs.readFileSync(new URL('../api/_gemini.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../src/vision/ai-full-state-runtime-r14.js', import.meta.url), 'utf8');
const context = fs.readFileSync(new URL('../src/vision/replay-context-runtime-r14.js', import.meta.url), 'utf8');
const gate = fs.readFileSync(new URL('../src/solver/study-safety-gate-r14.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const transaction = fs.readFileSync(new URL('../src/vision/state-transaction-runtime-r14.js', import.meta.url), 'utf8');

assert.match(api, /geminiJson/);
assert.match(api, /GEMINI/);
assert.match(gemini, /GEMINI_API_KEY/);
assert.match(gemini, /gemini-3\.1-flash-lite/);
assert.match(gemini, /gemini-3\.8-flash/);
assert.match(gemini, /responseMimeType: 'application\/json'/);
assert.match(gemini, /inlineData/);
assert.match(api, /Pot: read ONLY the central visible text label/);
assert.match(api, /Pote: 2\.508/);
assert.match(api, /Hero hole cards: if both are face-up and legible/);
assert.match(api, /Uncertain card => omit the whole Hero pair/);
assert.match(api, /Suit/);
assert.match(api, /tableSize means physical table capacity/);
assert.match(api, /heroToAct/);
assert.match(api, /seatsConfidence/);
assert.doesNotMatch(api, /api\.openai\.com/);
assert.doesNotMatch(api, /LOVABLE_API_KEY/);
assert.doesNotMatch(api, /ai\.gateway\.lovable\.dev/);

assert.match(context, /ai-full-state-runtime-r14/);
assert.doesNotMatch(context, /visual-table-runtime-r14b/);
assert.match(runtime, /\/api\/full-state/);
assert.match(runtime, /initialBurst/);
assert.match(runtime, /maxInFlight = initialBurst \? 2 : 1/);
assert.match(runtime, /machineStateKey/);
assert.match(runtime, /consecutiveFailures/);
assert.match(runtime, /lastRequestedStateKey/);
assert.match(runtime, /lastAppliedSeq/);
assert.doesNotMatch(runtime, /responses = new Map/);
assert.doesNotMatch(runtime, /applySeq/);
assert.match(runtime, /forceRebind: true/);
assert.match(runtime, /source: 'ai-full-frame'/);
assert.match(runtime, /MESA IA · FRAME INTEIRO/);

assert.doesNotMatch(gate, /__prcAIStateR14/);
assert.match(gate, /manual-hero/);
assert.match(gate, /ai-decision-raw-2of2/);
assert.match(gate, /physical-board-or-fast-identity/);
assert.match(gate, /fresh-table-context/);
assert.match(gate, /fastIdentityConsensus/);
assert.match(gate, /rawStableFrames >= 2/);
assert.match(gate, /stableFrames >= 2/);
assert.doesNotMatch(bootstrap, /pot-validation-runtime-r14/);
assert.match(transaction, /\['ai-full-frame', 'ai-decision', 'manual'\]/);
assert.match(transaction, /fastOwnsCurrentTurn/);
assert.match(transaction, /source === 'ai-full-frame' && fastOwnsCurrentTurn/);
assert.match(transaction, /fullPotBlocksDuringHeroTurn/);
assert.match(transaction, /forceRebind: Boolean\(options\?\.forceRebind\)/);

const machine = { handId: 9, state: { hero: [], board: [], street: 'preflop', pot: null } };
const arbiter = new DealSnapshotArbiter(machine);
const first = [
  { rank: 'A', suit: 'spades', confidence: 1 },
  { rank: 'T', suit: 'clubs', confidence: 1 },
];
assert.equal(arbiter.commitHero(first, { generation: 9 }).accepted, true);
const correctedSuit = [
  { rank: 'A', suit: 'hearts', confidence: 1 },
  { rank: 'T', suit: 'clubs', confidence: 1 },
];
const token = arbiter.beginManualRecalibration();
const rebound = arbiter.commitHero(correctedSuit, { generation: 9, rebindToken: token, forceRebind: true });
assert.equal(rebound.accepted, true);
assert.equal(rebound.rebound, true);
assert.equal(machine.state.hero[0].suit, 'hearts', 'authoritative/manual rebind must correct a wrong suit even when ranks match');

console.log('AI FULL STATE R14 passed');
