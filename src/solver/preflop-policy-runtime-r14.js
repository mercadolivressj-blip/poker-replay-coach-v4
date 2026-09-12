import { activeHandMachine } from '../core/state-machine.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';
import { classifyPreflopContext } from '../core/preflop-context-r14.js';
import { decisionStateKey, publishDecision, getDecision } from '../core/decision-store.js';
import { recommendUnopenedPreflop } from './preflop-policy-r14.js';

const LABEL = { fold: 'DESISTIR', check: 'PASSAR', call: 'PAGAR', raise: 'AUMENTAR', bet: 'APOSTAR', allin: 'ALL-IN' };
const diagnostics = { evaluations: 0, publishes: 0, lastMode: null, lastHandKey: null, lastDecision: null };
if (typeof window !== 'undefined') window.__prcPreflopPolicyR14 = diagnostics;

function completeHero(hero) {
  return Array.isArray(hero) && hero.length === 2 && hero.every((c) => c?.rank && c?.suit);
}

function fastSnapshot(machine) {
  const d = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;
  if (!d || Number(d.handId) !== Number(machine?.handId) || d.heroToAct !== true) return null;
  const stable = Math.max(Number(d.rawStableFrames) || 0, Number(d.stableDecisionFrames) || 0);
  if (!d.trusted || stable < 2 || !Array.isArray(d.actions) || d.actions.length < 2) return null;
  return d;
}

function tick() {
  const machine = activeHandMachine;
  if (!machine || machine.handId <= 0 || machine.state.street !== 'preflop' || !completeHero(machine.state.hero)) return;

  const fast = fastSnapshot(machine);
  if (!fast) return;
  const table = activeTableStateTracker?.latest;
  if (!table || Number(table.handId) !== Number(machine.handId) || !Array.isArray(table.seats) || !table.seats.length) return;

  const current = getDecision();
  if (current?.finalDecision) return;

  const context = classifyPreflopContext({
    seats: table.seats,
    heroCommitted: Number.isFinite(fast.heroCommitted) ? fast.heroCommitted : table.seats.find((s) => s.hero)?.committed,
    proposedAggressorName: fast.aggressorName,
    proposedAggressorCommitted: fast.aggressorCommitted,
  });
  diagnostics.evaluations++;
  diagnostics.lastMode = context.mode;
  if (context.mode !== 'unopened') return;

  const actions = fast.actions.map((a) => ({ type: a.type, amount: Number.isFinite(a.amount) ? a.amount : null }));
  const pot = Number.isFinite(fast.pot) ? fast.pot : machine.state.pot;
  const recommendation = recommendUnopenedPreflop({
    hero: machine.state.hero,
    position: table.heroPosition || context.heroPosition,
    actions,
    pot,
    sb: context.sb,
    bb: context.bb,
  });
  if (!recommendation?.decision) return;

  const handKey = `${machine.handId}:${table.heroPosition || context.heroPosition}:${machine.state.hero.map((c) => `${c.rank}${c.suit}`).join(',')}:${actions.map((a) => `${a.type}:${a.amount ?? '-'}`).join('|')}:${pot}`;
  if (diagnostics.lastHandKey === handKey && diagnostics.lastDecision === recommendation.decision) return;

  diagnostics.lastHandKey = handKey;
  diagnostics.lastDecision = recommendation.decision;
  const published = publishDecision({
    stateKey: decisionStateKey(machine.handId, machine.state),
    decision: LABEL[recommendation.decision] || recommendation.decision.toUpperCase(),
    reason: recommendation.reason,
    details: recommendation.details,
    confidence: recommendation.confidence,
    source: 'preflop-unopened-policy-r14',
    preflopMode: context.mode,
    policy: recommendation.policy,
  });
  if (published?.decision === (LABEL[recommendation.decision] || recommendation.decision.toUpperCase())) diagnostics.publishes++;
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', () => {
    diagnostics.lastHandKey = null;
    diagnostics.lastDecision = null;
    diagnostics.lastMode = null;
  });
}

setInterval(tick, 35);
setTimeout(tick, 0);
