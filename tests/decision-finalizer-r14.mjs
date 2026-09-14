import assert from 'node:assert/strict';

let clock = 100;
Object.defineProperty(globalThis, 'performance', {
  configurable: true,
  value: { now: () => clock },
});

const timers = [];
globalThis.setInterval = (fn, ms) => {
  timers.push({ fn, ms });
  return { unref() {} };
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
};

let turnChip = 'FORA DA VEZ';
globalThis.window = {
  __prcAIDecisionR14: null,
  __prcManualHeroAuthorityR14: { manualOnly: true, heroLocked: false, handId: 0 },
  dispatchEvent() {},
};

globalThis.document = {
  getElementById(id) {
    if (id === 'turnChip') return { textContent: turnChip };
    return null;
  },
};

const { HandMachine } = await import('../src/core/state-machine.js');
const machine = new HandMachine();
machine.newHand('decision-finalizer-test', clock);
machine.state.heroToAct = false;
machine.state.actions = [];

window.__prcAIDecisionR14 = {
  handId: machine.handId,
  heroToAct: null,
  actions: [],
  trustReason: 'Sua vez · IA rápida lendo a decisão atual.',
  lastSeenAt: 0,
  lastLatencyMs: null,
};
window.__prcManualHeroAuthorityR14.handId = machine.handId;

const store = await import(`../src/core/decision-store.js?decision-finalizer-test=${Date.now()}`);
const watchdog = timers.find((timer) => timer.ms === 100)?.fn;
assert.equal(typeof watchdog, 'function', 'decision watchdog must run independently every 100ms');

const first = store.clearDecision();
assert.equal(first?.decision, 'ANALISANDO', 'Hero turn may show ANALISANDO while cards are pending');
assert.equal(window.__prcDecisionFinalizerR14?.elapsedMs, 0);

clock = 9000;
watchdog();
assert.equal(store.getDecision()?.decision, 'ANALISANDO', 'time spent confirming Hero cards must not trigger a deadline');
assert.equal(window.__prcDecisionFinalizerR14?.elapsedMs, 0, 'decision clock must remain stopped before Hero is locked');

machine.state.hero = [
  { rank: 'A', suit: 'spades', confidence: 1 },
  { rank: 'K', suit: 'hearts', confidence: 1 },
];
window.__prcManualHeroAuthorityR14.heroLocked = true;
clock = 9100;
watchdog();
assert.equal(store.getDecision()?.decision, 'ANALISANDO');
assert.equal(window.__prcDecisionFinalizerR14?.elapsedMs, 0, 'clock begins only after Hero cards are ready');

clock = 16099;
watchdog();
assert.equal(store.getDecision()?.decision, 'ANALISANDO', 'must remain analyzing before 7s');

clock = 16200;
watchdog();
const slow = store.getDecision();
assert.equal(slow?.decision, 'ANALISANDO', 'elapsed time alone must never become LEITURA INSUFICIENTE in replay study');
assert.equal(window.__prcDecisionFinalizerR14?.deadlineReached, true);
assert.equal(window.__prcDecisionFinalizerR14?.timeoutDoesNotForceInsufficient, true);
assert.equal(window.__prcDecisionFinalizerR14?.strategicDeadlineFallback, false);
assert.equal(window.__prcDecisionFinalizerR14?.clockStartsAfterManualHero, true);

// Semantic action epoch: PokerStars local OCR can call an aggressive check-side
// button RAISE while the fast reader calls the exact same physical button BET.
// Those must be one decision epoch, not a reason to pull advice off screen.
const baseState = {
  street: 'flop',
  hero: machine.state.hero,
  board: [
    { rank: 'Q', suit: 'spades' },
    { rank: 'J', suit: 'diamonds' },
    { rank: '2', suit: 'clubs' },
  ],
  actions: [{ type: 'check', amount: null }, { type: 'bet', amount: 0.02 }],
};
const alternate = {
  ...baseState,
  actions: [{ type: 'raise', amount: 0.02 }, { type: 'check', amount: null }],
};
assert.equal(
  store.decisionEpochKey(machine.handId, baseState),
  store.decisionEpochKey(machine.handId, alternate),
  'CHECK+BET and CHECK+RAISE must normalize to the same physical decision epoch',
);

machine.state.street = 'flop';
machine.state.board = baseState.board;
machine.state.actions = baseState.actions;
machine.state.heroToAct = true;
turnChip = 'SUA VEZ';
window.__prcAIDecisionR14.trustReason = 'Sua vez · IA rápida lendo a decisão atual.';
window.__prcAIDecisionR14.heroToAct = true;
window.__prcAIDecisionR14.actions = baseState.actions;
clock = 16300;

const lateTrusted = store.publishDecision({
  stateKey: store.decisionStateKey(machine.handId, machine.state),
  decision: 'APOSTAR',
  reason: 'trusted current-state result arrived after 7s',
  details: 'validated strategy',
  confidence: 91,
});
assert.equal(lateTrusted?.decision, 'APOSTAR', 'a later trustworthy strategy must replace ANALISANDO while the same replay spot is current');
assert.equal(lateTrusted?.finalDecision, true);

// One-frame semantic/action oscillation must not erase a valid recommendation.
machine.state.actions = [{ type: 'check', amount: null }, { type: 'raise', amount: 0.02 }];
clock = 16380;
watchdog();
assert.equal(store.getDecision()?.decision, 'APOSTAR', 'semantic BET/RAISE oscillation must keep the valid decision visible');

// A short false negative in heroToAct must be absorbed by turn-end hysteresis.
window.__prcAIDecisionR14.trustReason = 'Aguardando decisão do Hero.';
window.__prcAIDecisionR14.heroToAct = false;
window.__prcAIDecisionR14.actions = [];
machine.state.heroToAct = false;
turnChip = 'FORA DA VEZ';
clock = 16700;
watchdog();
assert.equal(store.getDecision()?.decision, 'APOSTAR', 'brief hero-turn signal loss must not flash the recommendation off screen');

// After the grace window really expires, the completed turn clears normally.
clock = 17650;
watchdog();
assert.equal(store.getDecision(), null, 'final recommendation must clear after Hero turn actually ends');

console.log('DECISION FINALIZER R14 behavior passed');
