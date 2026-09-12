import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DealSnapshotArbiter } from '../src/core/deal-snapshot-arbiter-r14.js';

const api = fs.readFileSync(new URL('../api/full-state.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../src/vision/ai-full-state-runtime-r14.js', import.meta.url), 'utf8');
const context = fs.readFileSync(new URL('../src/vision/replay-context-runtime-r14.js', import.meta.url), 'utf8');
const gate = fs.readFileSync(new URL('../src/solver/study-safety-gate-r14.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const transaction = fs.readFileSync(new URL('../src/vision/state-transaction-runtime-r14.js', import.meta.url), 'utf8');

assert.match(api, /gpt-5\.6-luna/);
assert.match(api, /reasoning: \{ effort: 'none' \}/);
assert.match(api, /input_image/);
assert.match(api, /detail: 'high'/);
assert.match(api, /Pot: read only the central pot label/);
assert.match(api, /Seats: read every visible physical seat/);
assert.match(api, /Never return opponent hole cards/);
assert.match(api, /heroToAct/);
assert.match(api, /seatsConfidence/);

assert.match(context, /ai-full-state-runtime-r14/);
assert.doesNotMatch(context, /visual-table-runtime-r14b/);
assert.match(runtime, /\/api\/full-state/);
assert.match(runtime, /inFlight >= 2/);
assert.match(runtime, /lastAppliedSeq/);
assert.doesNotMatch(runtime, /responses = new Map/);
assert.doesNotMatch(runtime, /applySeq/);
assert.match(runtime, /forceRebind: true/);
assert.match(runtime, /source: 'ai-full-frame'/);
assert.match(runtime, /gpt-5\.6-luna-full-frame/);
assert.match(runtime, /MESA IA · FRAME INTEIRO/);
assert.match(gate, /__prcAIStateR14/);
assert.match(gate, /ai-full-frame/);
assert.doesNotMatch(bootstrap, /pot-validation-runtime-r14/);
assert.match(transaction, /\['ai-full-frame', 'manual'\]/);
assert.match(transaction, /forceRebind: Boolean\(options\?\.forceRebind\)/);

const machine = {
  handId: 9,
  state: { hero: [], board: [], street: 'preflop', pot: null },
};
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
