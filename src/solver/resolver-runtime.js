import { activeHandMachine } from '../core/state-machine.js';
import { activeActionTimeline } from '../core/action-timeline.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';
import { decisionStateKey, publishDecision, clearDecision } from '../core/decision-store.js';
import { ContinualResolver, resolverFingerprint } from './continual-resolver.js';

const AGGRO = new Set(['bet', 'raise', 'allin']);
const LABEL = { fold: 'DESISTIR', check: 'PASSAR', call: 'PAGAR', bet: 'APOSTAR', raise: 'AUMENTAR', allin: 'ALL-IN' };
const resolver = new ContinualResolver();
let lastHandId = 0;
let lastUiKey = '';
let lastPublished = null;
let applyingPublished = false;

function $(id) { return document.getElementById(id); }
function cloneCard(c) { return c ? { rank: c.rank, suit: c.suit || null, confidence: Number.isFinite(c.confidence) ? c.confidence : null, suitConfidence: Number.isFinite(c.suitConfidence) ? c.suitConfidence : null } : null; }
function completeCard(c) { return !!c?.rank && !!c?.suit; }
function cardsReady(state) {
  if (!state || state.hero?.length !== 2 || !state.hero.every(completeCard)) return false;
  if (state.street === 'preflop') return (state.board || []).length === 0;
  const expected = state.street === 'flop' ? 3 : state.street === 'turn' ? 4 : state.street === 'river' ? 5 : 0;
  return expected > 0 && state.board?.length === expected && state.board.every(completeCard);
}

function ensureResolverStatus() {
  const brain = $('brainStatus');
  if (!brain) return null;
  brain.style.display = 'none';
  let badge = $('resolverStatus');
  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'resolverStatus';
    badge.className = 'brain-status ready';
    badge.textContent = 'RESOLVER LOCAL';
    brain.insertAdjacentElement('afterend', badge);
  }
  return badge;
}

function snapshotTable(actorName) {
  const raw = activeTableStateTracker?.latest;
  if (!raw || raw.handId !== activeHandMachine?.handId) return null;
  const seats = (raw.seats || []).map((s) => ({ ...s }));
  const hero = seats.find((s) => s.hero) || null;
  let villain = actorName ? seats.find((s) => String(s.actorName || '').trim().toLowerCase() === String(actorName).trim().toLowerCase()) : null;
  if (!villain) {
    const active = seats.filter((s) => !s.hero && s.folded !== true);
    if (active.length === 1) villain = active[0];
  }
  const effectiveStack = Number.isFinite(hero?.stack) && Number.isFinite(villain?.stack) ? Math.min(hero.stack, villain.stack) : null;
  return {
    confidence: Number.isFinite(raw.confidence) ? raw.confidence : 0,
    dealerSeat: raw.dealerSeat ?? null,
    heroSeat: raw.heroSeat ?? null,
    heroPosition: raw.heroPosition || null,
    effectiveStack,
    seats,
  };
}

function villainActor(events, street, table) {
  const heroName = table?.seats?.find((s) => s.hero)?.actorName;
  const isHero = (e) => heroName && String(e.actorName || '').trim().toLowerCase() === String(heroName).trim().toLowerCase();
  const rivals = (events || []).filter((e) => !isHero(e));
  const sameStreet = rivals.filter((e) => e.street === street);
  const aggressive = [...sameStreet].reverse().find((e) => AGGRO.has(e.action) && e.actorName);
  if (aggressive) return aggressive.actorName;
  return [...rivals].reverse().find((e) => e.actorName)?.actorName || null;
}

function contextSnapshot(machine) {
  const events = activeActionTimeline?.handId === machine.handId ? activeActionTimeline.events.map((e) => ({ ...e })) : [];
  const provisionalTable = snapshotTable(null);
  const actorName = villainActor(events, machine.state.street, provisionalTable);
  const table = snapshotTable(actorName);
  const state = {
    street: machine.state.street,
    heroToAct: Boolean(machine.state.heroToAct),
    hero: (machine.state.hero || []).map(cloneCard).filter(Boolean),
    board: (machine.state.board || []).map(cloneCard).filter(Boolean),
    pot: Number.isFinite(machine.state.pot) ? machine.state.pot : null,
    actions: (machine.state.actions || []).map((a) => ({ type: a.type, amount: Number.isFinite(a.amount) ? a.amount : null })),
  };
  return { handId: machine.handId, state, events, actorName, table };
}

function applyPublished() {
  const machine = activeHandMachine;
  if (!machine || !lastPublished || lastPublished.stateKey !== decisionStateKey(machine.handId, machine.state) || applyingPublished) return;
  const decision = $('decisionText'), reason = $('decisionReason'), details = $('decisionDetails'), confidence = $('confidence');
  if (!decision || !reason || !details || !confidence) return;
  applyingPublished = true;
  try {
    if (decision.textContent !== lastPublished.decision) decision.textContent = lastPublished.decision;
    if (reason.textContent !== lastPublished.reason) reason.textContent = lastPublished.reason;
    if (details.textContent !== lastPublished.details) details.textContent = lastPublished.details;
    const conf = lastPublished.confidence > 0 ? `${lastPublished.confidence}%` : '—';
    if (confidence.textContent !== conf) confidence.textContent = conf;
  } finally { applyingPublished = false; }
}

function publishUi(entry) {
  lastPublished = entry;
  publishDecision(entry);
  applyPublished();
}

function publishInsufficient(machine, reason, statusBadge) {
  const stateKey = decisionStateKey(machine.handId, machine.state);
  publishUi({ stateKey, decision: 'LEITURA INSUFICIENTE', reason, details: 'O resolver não chuta informação ausente.', confidence: 0, source: 'resolver-local' });
  if (statusBadge) { statusBadge.textContent = reason.includes('naipe') ? 'RESOLVER · LENDO NAIPE' : 'RESOLVER · DADOS INSUFICIENTES'; statusBadge.className = 'brain-status'; }
}

function renderLocal(result, cacheHit, statusBadge, machine) {
  if (!result || result.decision === 'insufficient') {
    publishInsufficient(machine, result?.reason || 'Dados insuficientes para o resolver local.', statusBadge);
    return;
  }
  const bits = [];
  if (Number.isFinite(result.equity)) bits.push(`Equity local ~${Math.round(result.equity * 100)}%`);
  if (result.rangeSummary?.comboCount) bits.push(`range ${result.rangeSummary.comboCount} combos`);
  if (result.eventCount) bits.push(`histórico ${result.eventCount} ações`);
  if (result.localChatCount) bits.push(`chat local ${result.localChatCount}`);
  bits.push(cacheHit ? 'pré-calculado antes da sua vez' : `micro-resolve ${Math.round((result.preparedMs || 0) + (result.ms || 0))}ms`);
  if (result.caveats?.length) bits.push(result.caveats[0]);
  const uiKey = `${result.fingerprint}:${result.decision}:${result.confidence}:${bits.join('|')}`;
  if (uiKey !== lastUiKey) {
    lastUiKey = uiKey;
    publishUi({
      stateKey: decisionStateKey(machine.handId, machine.state),
      decision: LABEL[result.decision] || 'LEITURA INSUFICIENTE',
      reason: result.reason,
      details: bits.join(' · '),
      confidence: result.confidence,
      source: 'resolver-local',
      fingerprint: result.fingerprint,
    });
  } else applyPublished();
  if (statusBadge) {
    statusBadge.textContent = cacheHit ? `RESOLVER PRONTO · ${result.ms.toFixed(1)}ms` : `RESOLVER · ${Math.round((result.preparedMs || 0) + result.ms)}ms`;
    statusBadge.className = 'brain-status ready';
  }
}

function tick() {
  const statusBadge = ensureResolverStatus();
  const machine = activeHandMachine;
  if (!machine) return;
  if (machine.handId !== lastHandId) {
    lastHandId = machine.handId;
    resolver.resetHand();
    lastUiKey = '';
    lastPublished = null;
    clearDecision();
  }

  if (machine.handId <= 0) {
    if (statusBadge) statusBadge.textContent = 'RESOLVER LOCAL';
    return;
  }
  if (machine.state.hero?.length !== 2) {
    if (machine.state.heroToAct) publishInsufficient(machine, 'Ainda estou confirmando suas cartas.', statusBadge);
    else if (statusBadge) statusBadge.textContent = 'RESOLVER · LENDO CARTAS';
    return;
  }
  const missingSuit = machine.state.hero.some((c) => !c?.suit) || (machine.state.board || []).some((c) => c?.rank && !c?.suit);
  if (missingSuit || !cardsReady(machine.state)) {
    if (machine.state.heroToAct) publishInsufficient(machine, 'Ainda estou confirmando o naipe das cartas.', statusBadge);
    else if (statusBadge) statusBadge.textContent = 'RESOLVER · LENDO NAIPE';
    return;
  }
  if (!Number.isFinite(machine.state.pot)) {
    if (machine.state.heroToAct) publishInsufficient(machine, 'Ainda estou confirmando o pote.', statusBadge);
    else if (statusBadge) statusBadge.textContent = 'RESOLVER · LENDO POTE';
    return;
  }

  const context = contextSnapshot(machine);
  const fingerprint = resolverFingerprint(context);
  resolver.schedule(context);

  if (!machine.state.heroToAct || !machine.state.actions?.length) {
    lastPublished = null;
    clearDecision();
    if (statusBadge) statusBadge.textContent = resolver.prepared?.fingerprint === fingerprint ? 'RESOLVER PRÉ-CALCULADO' : 'RESOLVER CALCULANDO';
    return;
  }

  const cacheHit = resolver.prepared?.fingerprint === fingerprint;
  const result = resolver.resolve(context, machine.state.actions);
  renderLocal(result, cacheHit, statusBadge, machine);
}

const observerTarget = document.querySelector('.coach-card') || document.body;
if (observerTarget && typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(() => applyPublished());
  observer.observe(observerTarget, { subtree: true, childList: true, characterData: true });
}

setInterval(tick, 45);
setTimeout(tick, 0);
