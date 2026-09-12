import { setDecisionGate } from '../core/decision-store.js';

const STRATEGIC = new Set(['PAGAR','DESISTIR','PASSAR','APOSTAR','AUMENTAR','ALL-IN']);

function aiTrust() {
  const d = typeof window !== 'undefined' ? window.__prcAIStateR14 : null;
  const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  const age = Number.isFinite(Number(d?.lastSeenAt)) && Number(d.lastSeenAt) > 0 ? now - Number(d.lastSeenAt) : Infinity;
  return {
    trusted: Boolean(d?.trusted) && age <= 4500,
    reason: d?.trustReason || 'A IA ainda não validou o frame inteiro.',
    age,
    responses: Number(d?.responses) || 0,
    stableFrames: Number(d?.stableFrames) || 0,
    confidence: Number(d?.confidence) || 0,
    seats: Array.isArray(d?.seats) ? d.seats.length : 0,
    pot: Number.isFinite(Number(d?.pot)) ? Number(d.pot) : null,
    error: d?.lastError || null,
  };
}

setDecisionGate((entry) => {
  if (!entry || !STRATEGIC.has(entry.decision)) return entry;
  const ai = aiTrust();
  if (ai.trusted) return entry;

  const freshness = Number.isFinite(ai.age) ? `${Math.round(ai.age)}ms atrás` : 'sem leitura válida';
  const reason = ai.error
    ? `IA de visão indisponível: ${ai.error}`
    : ai.reason;

  return {
    ...entry,
    decision: 'LEITURA INSUFICIENTE',
    reason,
    details: `Segurança de estudo ativa · IA full-frame ${Math.round(ai.confidence * 100)}% · ${ai.seats} assentos · ${ai.stableFrames}/2 confirmações · ${freshness}. O solver fica bloqueado até a IA confirmar o estado inteiro da mesa.`,
    confidence: 0,
    source: 'study-safety-gate-ai-r14',
  };
});

if (typeof window !== 'undefined') window.__prcStudySafetyGateR14 = { enabled: true, requires: ['ai-full-frame'] };
