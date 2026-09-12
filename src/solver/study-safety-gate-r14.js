import { setDecisionGate } from '../core/decision-store.js';

const STRATEGIC = new Set(['PAGAR','DESISTIR','PASSAR','APOSTAR','AUMENTAR','ALL-IN']);

function visualTrust() {
  const d = typeof window !== 'undefined' ? window.__prcVisualTableR14 : null;
  return {
    trusted: Boolean(d?.trusted),
    reason: d?.trustReason || 'Mesa visual ainda não validada.',
    tracked: Number(d?.trackedSeats) || 0,
    expected: Number(d?.expectedSeats) || 0,
    stableFrames: Number(d?.stableFrames) || 0,
  };
}

setDecisionGate((entry) => {
  if (!entry || !STRATEGIC.has(entry.decision)) return entry;
  const trust = visualTrust();
  if (trust.trusted) return entry;
  const coverage = trust.expected > 0 ? `${trust.tracked}/${trust.expected} assentos` : `${trust.tracked} assentos`;
  return {
    ...entry,
    decision: 'LEITURA INSUFICIENTE',
    reason: trust.reason,
    details: `Segurança de estudo ativa · ${coverage} confirmados · ${trust.stableFrames} leituras estáveis. A decisão estratégica fica bloqueada até a mesa ser validada.`,
    confidence: 0,
    source: 'study-safety-gate-r14',
  };
});

if (typeof window !== 'undefined') window.__prcStudySafetyGateR14 = { enabled: true };
