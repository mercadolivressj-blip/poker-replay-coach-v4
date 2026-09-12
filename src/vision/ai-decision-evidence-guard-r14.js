import { isPlausibleActorName, resolveAggressorEvidence } from '../core/poker-evidence-r14.js';

function fmt(n) {
  return Number.isFinite(n) ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(n) : '—';
}

function sanitize() {
  if (typeof window === 'undefined') return;
  const d = window.__prcAIDecisionR14;
  if (!d || !d.lastSeenAt) return;
  const seats = Array.isArray(window.__prcAIStateR14?.seats) ? window.__prcAIStateR14.seats : [];
  if (!seats.length && isPlausibleActorName(d.aggressorName)) return;

  const evidence = resolveAggressorEvidence({
    proposedName: d.aggressorName,
    proposedCommitted: d.aggressorCommitted,
    heroCommitted: d.heroCommitted,
    seats,
  });

  const changed = (d.aggressorName || null) !== (evidence?.actorName || null)
    || (Number.isFinite(evidence?.committed) && d.aggressorCommitted !== evidence.committed);
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
