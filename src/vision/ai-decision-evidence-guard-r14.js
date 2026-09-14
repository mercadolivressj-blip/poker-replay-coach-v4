import { isPlausibleActorName, resolveAggressorEvidence } from '../core/poker-evidence-r14.js';
import { activeHandMachine } from '../core/state-machine.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';
import { classifyPreflopContext } from '../core/preflop-context-r14.js';

function fmt(n) {
  return Number.isFinite(n) ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(n) : '—';
}

function preflopEvidence(d) {
  const machine = activeHandMachine;
  const table = activeTableStateTracker?.latest;
  if (!machine || machine.state?.street !== 'preflop') return undefined;
  if (!table || Number(table.handId) !== Number(machine.handId) || !Array.isArray(table.seats) || table.seats.length < 2) return undefined;

  const context = classifyPreflopContext({
    seats: table.seats,
    heroCommitted: d.heroCommitted,
    proposedAggressorName: d.aggressorName,
    proposedAggressorCommitted: d.aggressorCommitted,
  });

  // Mandatory SB/BB postings and limps are not aggression. This is deliberately
  // stronger than the vision model's proposed actor so a posted BB can never be
  // promoted to a raise merely because its commitment is the largest blind.
  if (context.mode !== 'raised') return null;
  if (!context.aggressorName) return null;
  return {
    actorName: context.aggressorName,
    committed: Number.isFinite(context.aggressorCommitted) ? context.aggressorCommitted : null,
    source: 'preflop-context-r14',
    confidence: 0.96,
  };
}

function sanitize() {
  if (typeof window === 'undefined') return;
  const d = window.__prcAIDecisionR14;
  if (!d || !d.lastSeenAt) return;

  const tableSeats = activeTableStateTracker?.latest?.seats;
  const fullSeats = Array.isArray(window.__prcAIStateR14?.seats) ? window.__prcAIStateR14.seats : [];
  const seats = Array.isArray(tableSeats) && tableSeats.length ? tableSeats : fullSeats;

  let evidence = preflopEvidence(d);
  if (evidence === undefined) {
    if (!seats.length && isPlausibleActorName(d.aggressorName)) return;
    evidence = resolveAggressorEvidence({
      proposedName: d.aggressorName,
      proposedCommitted: d.aggressorCommitted,
      heroCommitted: d.heroCommitted,
      seats,
    });
  }

  const changed = (d.aggressorName || null) !== (evidence?.actorName || null)
    || (Number.isFinite(evidence?.committed) ? d.aggressorCommitted !== evidence.committed : Number.isFinite(d.aggressorCommitted));
  if (!changed) return;

  d.aggressorName = evidence?.actorName || null;
  d.aggressorCommitted = Number.isFinite(evidence?.committed) ? evidence.committed : null;
  d.aggressorConfidence = evidence ? Math.max(Number(d.aggressorConfidence) || 0, Number(evidence.confidence) || 0) : 0;
  d.aggressorSource = evidence?.source || null;

  const detail = document.getElementById('decisionVisionDetail');
  if (detail) {
    const actions = (d.actions || []).map((a) => `${String(a.type).toUpperCase()}${Number.isFinite(a.amount) ? ` ${fmt(a.amount)}` : ''}`).join(' · ');
    detail.textContent = `${actions || 'ações pendentes'}${d.aggressorName ? ` · agressor ${d.aggressorName}` : ''}${d.consecutiveFailures ? ' · reconectando' : ''}`;
  }
}

setInterval(sanitize, 80);
setTimeout(sanitize, 120);
