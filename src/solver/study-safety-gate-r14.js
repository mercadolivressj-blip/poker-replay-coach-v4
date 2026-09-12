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

function potTrust() {
  const d = typeof window !== 'undefined' ? window.__prcPotTrustR14 : null;
  return {
    trusted: Boolean(d?.trusted),
    value: Number.isFinite(Number(d?.value)) ? Number(d.value) : null,
    reads: Number(d?.reads) || 0,
    manual: Boolean(d?.manual),
  };
}

setDecisionGate((entry) => {
  if (!entry || !STRATEGIC.has(entry.decision)) return entry;
  const table = visualTrust();
  const pot = potTrust();
  if (table.trusted && pot.trusted) return entry;

  const coverage = table.expected > 0 ? `${table.tracked}/${table.expected} assentos` : `${table.tracked} assentos`;
  let reason = table.reason;
  if (table.trusted && !pot.trusted) reason = 'O pote ainda não foi confirmado por leituras independentes.';
  const potLabel = pot.trusted ? `pote ${pot.value}` : `pote não validado (${pot.reads} leituras)`;

  return {
    ...entry,
    decision: 'LEITURA INSUFICIENTE',
    reason,
    details: `Segurança de estudo ativa · ${coverage} confirmados · ${table.stableFrames} leituras estáveis · ${potLabel}. Nenhuma decisão estratégica é liberada enquanto mesa e pote não estiverem validados.`,
    confidence: 0,
    source: 'study-safety-gate-r14',
  };
});

if (typeof window !== 'undefined') window.__prcStudySafetyGateR14 = { enabled: true, requires: ['visual-table', 'pot'] };
