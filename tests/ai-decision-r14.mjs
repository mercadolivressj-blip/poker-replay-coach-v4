import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estimateActionValues } from '../src/solver/value-engine.js';

const api = fs.readFileSync(new URL('../api/decision-state.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../src/vision/ai-decision-runtime-r14.js', import.meta.url), 'utf8');
const consensus = fs.readFileSync(new URL('../src/vision/ai-decision-consensus-r14.js', import.meta.url), 'utf8');
const resolver = fs.readFileSync(new URL('../src/solver/resolver-runtime.js', import.meta.url), 'utf8');
const gate = fs.readFileSync(new URL('../src/solver/study-safety-gate-r14.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/core/decision-store.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const fullApi = fs.readFileSync(new URL('../api/full-state.js', import.meta.url), 'utf8');

assert.match(api, /gpt-5\.6-luna/);
assert.match(api, /poker_replay_decision_state/);
assert.match(api, /heroActions/);
assert.match(api, /aggressorName/);
assert.match(api, /Pago US\$ 0,04/);
assert.match(api, /Pote: 630/);
assert.match(api, /Pote: 2\.508/);
assert.match(api, /Pago 120/);
assert.match(api, /Aumento para 240/);
assert.match(fullApi, /Tournament formatting matters/);
assert.match(fullApi, /Pote: 630/);
assert.match(fullApi, /2508/);
assert.match(runtime, /\/api\/decision-state/);
assert.match(runtime, /fillDerivedCall/);
assert.match(runtime, /aggressorCommitted - heroCommitted/);
assert.match(runtime, /__prcAIDecisionR14/);
assert.match(runtime, /uiHeroTurn/);
assert.match(runtime, /fullFrameHeroTurn/);
assert.match(runtime, /window\.__prcAIStateR14/);
assert.match(runtime, /fastFrameStillHeroTurn/);
assert.match(runtime, /diagnostics\.heroToAct === false/);
assert.match(runtime, /turnSignalStartedAt/);
assert.doesNotMatch(runtime, /actionCount >= 2/);
assert.doesNotMatch(runtime, /title\.includes\('DECISÃO DO HERO'\)/);
assert.match(runtime, /DECISÃO IA · RÁPIDA/);
assert.match(runtime, /burstRemaining = 2/);
assert.match(runtime, /const maxInFlight = 1/);
assert.match(runtime, /rawStableFrames/);
assert.match(runtime, /candidateHits < 2/);
assert.match(runtime, /stableFrames >= 2/);
assert.match(runtime, /consecutiveFailures/);
assert.match(consensus, /stableHits >= 2/);
assert.match(consensus, /rawStableFrames/);
assert.match(consensus, /stableDecisionFrames/);
assert.match(consensus, /snapshotKey/);
assert.match(resolver, /fastDecision/);
assert.match(resolver, /ai-decision-frame-r14/);
assert.match(resolver, /mergeDecisionActions/);
assert.match(gate, /decisionTrust/);
assert.match(gate, /ai-decision-raw-2of2/);
assert.match(gate, /physical-board-or-fast-identity/);
assert.match(gate, /fastIdentityConsensus/);
assert.match(gate, /rawStableFrames >= 2/);
assert.match(gate, /stableFrames >= 2/);
assert.doesNotMatch(gate, /aiTrust\(/);
assert.match(store, /HARD_DEADLINE_MS = 7000/);
assert.match(store, /WATCHDOG_MS = 100/);
assert.match(store, /fastTurnSignal/);
assert.match(store, /startsWith\('Sua vez'\)/);
assert.match(store, /freshDecisionFrame/);
assert.match(store, /decisionWatchdog/);
assert.match(store, /setInterval\(decisionWatchdog, WATCHDOG_MS\)/);
assert.match(store, /lockedFinal/);
assert.match(store, /manualHeroReadyForDecision/);
assert.match(store, /clockStartsAfterManualHero: true/);
assert.match(store, /strategicDeadlineFallback: false/);
assert.match(store, /deadlineInsufficientDecision/);
assert.match(store, /não vai transformar falta de informação em FOLD/);
assert.match(store, /ANALISANDO/);
assert.doesNotMatch(store, /conservativeDeadlineDecision/);
assert.match(bootstrap, /ai-decision-runtime-r14/);
assert.match(bootstrap, /ai-decision-consensus-r14/);
assert.match(bootstrap, /ai-decision-pot-bridge-r14/);

const base = {
  equity: 0.28,
  pot: 100,
  actions: [{ type: 'fold' }, { type: 'call', amount: 40 }, { type: 'raise', amount: 100 }],
  street: 'preflop',
  evidenceQuality: 0.9,
  actorKnown: true,
};
const hu = estimateActionValues({ ...base, rangeSummary: { strongShare: 0.25, drawShare: 0.1, airShare: 0.35, rangeCount: 1 } });
const mw = estimateActionValues({ ...base, rangeSummary: { strongShare: 0.25, drawShare: 0.1, airShare: 0.35, rangeCount: 2 } });
const huRaise = hu.find((x) => x.action === 'raise');
const mwRaise = mw.find((x) => x.action === 'raise');
assert.ok(huRaise && mwRaise);
assert.ok(mwRaise.foldEquity < huRaise.foldEquity, 'multiway raise must receive less fold equity than heads-up');

console.log('AI DECISION R14 passed');
