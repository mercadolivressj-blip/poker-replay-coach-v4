import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estimateActionValues } from '../src/solver/value-engine.js';

const api = fs.readFileSync(new URL('../api/decision-state.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../src/vision/ai-decision-runtime-r14.js', import.meta.url), 'utf8');
const fieldConsensus = fs.readFileSync(new URL('../src/vision/ai-decision-field-consensus-r14.js', import.meta.url), 'utf8');
const legalActionGuard = fs.readFileSync(new URL('../src/vision/legal-action-guard-r14.js', import.meta.url), 'utf8');
const consensus = fs.readFileSync(new URL('../src/vision/ai-decision-consensus-r14.js', import.meta.url), 'utf8');
const resolver = fs.readFileSync(new URL('../src/solver/resolver-runtime.js', import.meta.url), 'utf8');
const gate = fs.readFileSync(new URL('../src/solver/decision-core-gate-r14.js', import.meta.url), 'utf8');
const decisionCore = fs.readFileSync(new URL('../src/solver/decision-core-r14.js', import.meta.url), 'utf8');
const fundamental = fs.readFileSync(new URL('../src/solver/fundamental-resolver-runtime-r14.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/core/decision-store.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../src/bootstrap-r14.js', import.meta.url), 'utf8');
const fullApi = fs.readFileSync(new URL('../api/full-state.js', import.meta.url), 'utf8');
const money = fs.readFileSync(new URL('../src/vision/money-runtime-r13.js', import.meta.url), 'utf8');

assert.match(api, /gpt-5\.6-luna/);
assert.match(api, /poker_replay_decision_state/);
assert.match(api, /heroActions/);
assert.match(api, /aggressorName/);
assert.match(api, /Pago US\$ 0,04/);
assert.match(api, /Pote: 630/);
assert.match(api, /Pote: 2\.508/);
assert.match(api, /Pago 120/);
assert.match(api, /Aumento para 240/);
assert.match(api, /Always return hero=\[\] and heroConfidence=0/);
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
assert.match(runtime, /const maxInFlight = initialBurst \? 2 : 1/);
assert.match(runtime, /rawStableFrames/);
assert.match(runtime, /candidateHits < 2/);
assert.match(runtime, /stableFrames >= 2/);
assert.match(runtime, /consecutiveFailures/);
assert.match(runtime, /manualHeroCards/);
assert.match(runtime, /__prcManualHeroAuthorityR14/);
assert.match(runtime, /diagnostics\.heroConfidence = manualHero\.length === 2 \? 1 : 0/);
assert.match(runtime, /diagnostics\.hero = manualHero/);
assert.match(runtime, /Hero is manual-only in R14/);
assert.doesNotMatch(runtime, /machine\.setHero\(out\.hero/);
assert.match(runtime, /settledResponses/);
assert.match(runtime, /flushSettledResponses/);

// Public pre-reading remains useful, but it is no longer a mandatory 2/2
// strategy gate. The current-state core can answer from one strong current frame
// once physical actions + table/stacks/position are coherent.
assert.match(runtime, /Hero is manual-only and therefore MUST NOT participate in public/);
assert.match(runtime, /diagnostics\.publicPrepared/);
assert.match(runtime, /bindManualHeroToPreparedSnapshot/);
assert.match(runtime, /prc:manual-state-applied/);
assert.match(bootstrap, /ai-decision-field-consensus-r14/);
assert.match(fieldConsensus, /boardHits/);
assert.match(fieldConsensus, /potHits/);
assert.match(fieldConsensus, /actionsHits/);
assert.match(fieldConsensus, /aggressorHits/);
assert.match(fieldConsensus, /Object\.defineProperty\(d, 'actions'/);

// Pot UX: one fresh, high-confidence fast read can update DISPLAY; canonical
// state is still protected by public-state consensus/arbiter.
assert.match(money, /fastProvisionalPot/);
assert.match(money, /Number\(fast\.potConfidence\) < 0\.92/);
assert.match(money, /fast\.heroToAct === true \|\| actions\.length >= 2/);
assert.match(money, /potEl\.dataset\.fastProvisional/);
assert.match(money, /setInterval\(syncMoneyUi, 45\)/);

// Legal actions remain physical truth. The strategy gate also checks that its
// proposed action exists in the CURRENT button set.
assert.match(bootstrap, /legal-action-guard-r14/);
assert.match(legalActionGuard, /facingBet = types\.includes\('fold'\) && types\.includes\('call'\)/);
assert.match(legalActionGuard, /unopened = types\.includes\('check'\) && types\.includes\('bet'\)/);
assert.match(legalActionGuard, /safeRaw\.filter\(\(action\) => legal\.has/);
assert.match(gate, /DECISION_TO_ACTION/);
assert.match(gate, /currentDecisionCoreEvidence/);
assert.match(gate, /liveStateKey/);
assert.match(gate, /coreStateKey/);
assert.match(gate, /A recomendação não existe entre os botões físicos atuais/);
assert.match(gate, /accepted-current-core/);

// Current-state core requires Hero, board, pot, action, table, stacks and
// preflop position. Hero may be confirmed manually or by the local uploaded-file
// refiner; remote AI still never owns Hero identity.
assert.match(decisionCore, /Aguardando confirmação das duas cartas do Hero/);
assert.match(decisionCore, /heroSource/);
assert.match(decisionCore, /Board\/street atual ainda não está completo/);
assert.match(decisionCore, /Pote atual ainda não foi confirmado/);
assert.match(decisionCore, /Os botões físicos e a leitura atual ainda não concordam/);
assert.match(decisionCore, /Stacks efetivos ainda não estão confirmados/);
assert.match(decisionCore, /A posição pré-flop do Hero ainda não foi confirmada/);
assert.doesNotMatch(decisionCore, /rawStableFrames >= 2/);
assert.match(fundamental, /REFINEMENT_GRACE_MS = 180/);
assert.match(fundamental, /range populacional fundamental/);
assert.match(fundamental, /allowGenericCall: true/);
assert.match(fundamental, /recommendUnopenedPreflop/);
assert.match(resolver, /fastDecision/);
assert.match(resolver, /mergeDecisionActions/);

// Decision lock belongs to the current decision epoch. A preflop decision may
// not leak to flop or to a new price/action set. The 7s watchdog starts only
// after Hero has actually been confirmed and locked.
assert.match(store, /HARD_DEADLINE_MS = 7000/);
assert.match(store, /WATCHDOG_MS = 100/);
assert.match(store, /fastTurnSignal/);
assert.match(store, /decisionWatchdog/);
assert.match(store, /lockedFinal/);
assert.match(store, /decisionEpochKey/);
assert.match(store, /invalidateStaleLock/);
assert.match(store, /lockFollowsDecisionEpoch: true/);
assert.match(store, /manualHeroReadyForDecision/);
assert.match(store, /clockStartsAfterManualHero: true/);
assert.match(store, /clockStartsAfterHeroConfirmation: true/);
assert.match(store, /strategicDeadlineFallback: false/);
assert.match(store, /deadlineInsufficientDecision/);
assert.match(store, /não vai transformar falta de informação em FOLD/);
assert.match(store, /relógio estratégico ainda NÃO começou/);
assert.match(store, /ANALISANDO/);
assert.doesNotMatch(store, /conservativeDeadlineDecision/);

assert.match(bootstrap, /ai-decision-runtime-r14/);
assert.match(bootstrap, /ai-decision-consensus-r14/);
assert.match(bootstrap, /ai-decision-pot-bridge-r14/);
assert.match(bootstrap, /manual-hero-boundary-r14/);
assert.match(bootstrap, /hero-refiner-runtime-r14/);
assert.match(bootstrap, /decision-core-gate-r14/);
assert.match(bootstrap, /fundamental-resolver-runtime-r14/);
assert.doesNotMatch(bootstrap, /study-safety-gate-r14/);
assert.doesNotMatch(bootstrap, /preflop-policy-runtime-r14/);

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
