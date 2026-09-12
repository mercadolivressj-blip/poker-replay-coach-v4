import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../api/decision-state.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../src/vision/ai-decision-runtime-r14.js', import.meta.url), 'utf8');
const resolver = fs.readFileSync(new URL('../src/solver/resolver-runtime.js', import.meta.url), 'utf8');
const gate = fs.readFileSync(new URL('../src/solver/study-safety-gate-r14.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');

assert.match(api, /gpt-5\.6-luna/);
assert.match(api, /poker_replay_decision_state/);
assert.match(api, /heroActions/);
assert.match(api, /aggressorName/);
assert.match(api, /Pago US\$ 0,04/);
assert.match(runtime, /\/api\/decision-state/);
assert.match(runtime, /fillDerivedCall/);
assert.match(runtime, /aggressorCommitted - heroCommitted/);
assert.match(runtime, /__prcAIDecisionR14/);
assert.match(resolver, /fastDecision/);
assert.match(resolver, /ai-decision-frame-r14/);
assert.match(resolver, /mergeDecisionActions/);
assert.match(gate, /decisionTrust/);
assert.match(gate, /ai-decision-frame/);
assert.match(bootstrap, /ai-decision-runtime-r14/);
assert.match(bootstrap, /ai-decision-pot-bridge-r14/);

console.log('AI DECISION R14 passed');
