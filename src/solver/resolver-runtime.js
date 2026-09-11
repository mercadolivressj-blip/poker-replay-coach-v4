import { activeHandMachine } from '../core/state-machine.js';
import { activeActionTimeline } from '../core/action-timeline.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';
import { ContinualResolver, resolverFingerprint } from './continual-resolver.js';

const AGGRO = new Set(['bet', 'raise', 'allin']);
const LABEL = { fold: 'DESISTIR', check: 'PASSAR', call: 'PAGAR', bet: 'APOSTAR', raise: 'AUMENTAR', allin: 'ALL-IN' };
const resolver = new ContinualResolver();
let lastHandId = 0;
let lastUiKey = '';
let auditedFingerprint = null;
let wasBrainReady = false;

function $(id) { return document.getElementById(id); }
function cloneCard(c) { return c ? { rank: c.rank, suit: c.suit || null, confidence: Number.isFinite(c.confidence) ? c.confidence : null } : null; }

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

function remoteAuditOwnsUi(fingerprint, statusBadge) {
  const brain = $('brainStatus');
  const ready = !!brain && brain.classList.contains('ready') && String(brain.textContent || '').startsWith('CÉREBRO');
  if (ready && !wasBrainReady) auditedFingerprint = fingerprint;
  wasBrainReady = ready;
  if (ready && auditedFingerprint === fingerprint) {
    if (statusBadge) statusBadge.textContent = 'AUDITOR ✓';
    return true;
  }
  return false;
}

function renderLocal(result, cacheHit, statusBadge) {
  if (!result || result.decision === 'insufficient') return;
  const decision = $('decisionText');
  const reason = $('decisionReason');
  const details = $('decisionDetails');
  const confidence = $('confidence');
  if (!decision || !reason || !details || !confidence) return;

  const uiKey = `${result.fingerprint}:${result.decision}:${result.confidence}:${cacheHit}`;
  if (uiKey === lastUiKey) return;
  lastUiKey = uiKey;
  decision.textContent = LABEL[result.decision] || 'LEITURA INSUFICIENTE';
  reason.textContent = result.reason;
  const bits = [];
  if (Number.isFinite(result.equity)) bits.push(`Equity local ~${Math.round(result.equity * 100)}%`);
  if (result.rangeSummary?.comboCount) bits.push(`range ${result.rangeSummary.comboCount} combos`);
  bits.push(cacheHit ? 'pré-calculado antes da sua vez' : `micro-resolve ${Math.round((result.preparedMs || 0) + (result.ms || 0))}ms`);
  if (result.caveats?.length) bits.push(result.caveats[0]);
  details.textContent = bits.join(' · ');
  confidence.textContent = `${result.confidence}%`;
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
    auditedFingerprint = null;
    wasBrainReady = false;
  }
  if (machine.handId <= 0 || machine.state.hero?.length !== 2 || !Number.isFinite(machine.state.pot)) {
    if (statusBadge) statusBadge.textContent = 'RESOLVER LOCAL';
    return;
  }

  const context = contextSnapshot(machine);
  const fingerprint = resolverFingerprint(context);
  resolver.schedule(context);

  if (!machine.state.heroToAct || !machine.state.actions?.length) {
    if (statusBadge) statusBadge.textContent = resolver.prepared?.fingerprint === fingerprint ? 'RESOLVER PRÉ-CALCULADO' : 'RESOLVER CALCULANDO';
    return;
  }
  if (remoteAuditOwnsUi(fingerprint, statusBadge)) return;

  const cacheHit = resolver.prepared?.fingerprint === fingerprint;
  const result = resolver.resolve(context, machine.state.actions);
  renderLocal(result, cacheHit, statusBadge);
}

setInterval(tick, 60);
setTimeout(tick, 0);
