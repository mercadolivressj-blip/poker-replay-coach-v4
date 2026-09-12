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

globalThis.window = {
  __prcAIDecisionR14: null,
  dispatchEvent() {},
};

globalThis.document = {
  getElementById(id) {
    if (id === 'turnChip') return { textContent: 'FORA DA VEZ' };
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

const store = await import(`../src/core/decision-store.js?decision-finalizer-test=${Date.now()}`);
const watchdog = timers.find((timer) => timer.ms === 100)?.fn;
assert.equal(typeof watchdog, 'function', 'decision watchdog must run independently every 100ms');

const first = store.clearDecision();
assert.equal(first?.decision, 'ANALISANDO', 'fast Hero-turn lifecycle must start ANALISANDO even when local action buttons are missing');
assert.equal(window.__prcDecisionFinalizerR14?.elapsedMs, 0);

clock = 7099;
watchdog();
assert.equal(store.getDecision()?.decision, 'ANALISANDO', 'must not finalize before the 7s deadline');

clock = 7200;
watchdog();
const deadline = store.getDecision();
assert.equal(deadline?.decision, 'DESISTIR', 'unreadable decision at deadline must fail closed instead of staying silent');
assert.equal(deadline?.finalDecision, true);
assert.equal(deadline?.deadlineFinal, true);

const attemptedChange = store.publishDecision({
  stateKey: store.decisionStateKey(machine.handId, machine.state),
  decision: 'AUMENTAR',
  reason: 'late conflicting result',
  details: '',
  confidence: 99,
});
assert.equal(attemptedChange?.decision, 'DESISTIR', 'once final, the action must remain frozen until Hero acts');

window.__prcAIDecisionR14.trustReason = 'Aguardando decisão do Hero.';
window.__prcAIDecisionR14.heroToAct = false;
window.__prcAIDecisionR14.actions = [];
machine.state.heroToAct = false;
clock = 7300;
watchdog();
assert.equal(store.getDecision(), null, 'final recommendation must clear after Hero turn ends');

console.log('DECISION FINALIZER R14 behavior passed');
