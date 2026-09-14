import { activeHandMachine } from '../core/state-machine.js';
import { decisionStateKey, setDecisionGate } from '../core/decision-store.js';
import { currentDecisionCoreEvidence } from './decision-core-r14.js';

const STRATEGIC = new Set(['PAGAR','DESISTIR','PASSAR','APOSTAR','AUMENTAR','ALL-IN']);
const DECISION_TO_ACTION = Object.freeze({
  PAGAR: 'call',
  DESISTIR: 'fold',
  PASSAR: 'check',
  APOSTAR: 'bet',
  AUMENTAR: 'raise',
  'ALL-IN': 'allin',
});

const diagnostics = {
  enabled: true,
  accepted: 0,
  blockedCore: 0,
  blockedStale: 0,
  blockedIllegal: 0,
  lastReason: 'boot',
};

function insufficient(entry, reason, core = null, source = 'decision-core-gate-r14') {
  return {
    ...entry,
    decision: 'LEITURA INSUFICIENTE',
    reason,
    details: `NÚCLEO ATUAL · ${core?.ready ? `confiança ${core.confidence}%` : 'pendente'} · ${core?.street || activeHandMachine?.state?.street || '?'} · ${core?.activeOpponentCount ?? '?'} adversário(s) ativo(s).`,
    confidence: 0,
    source,
  };
}

setDecisionGate((entry) => {
  if (!entry || !STRATEGIC.has(entry.decision)) return entry;

  const core = currentDecisionCoreEvidence();
  if (!core.ready) {
    diagnostics.blockedCore++;
    diagnostics.lastReason = `core:${core.reason}`;
    return insufficient(entry, core.reason, core);
  }

  const liveStateKey = decisionStateKey(activeHandMachine?.handId, activeHandMachine?.state || {});
  const coreStateKey = decisionStateKey(core.handId, {
    street: core.street,
    hero: core.hero,
    board: core.board,
    pot: core.pot,
    actions: core.actions,
  });
  if (!entry.stateKey || (entry.stateKey !== liveStateKey && entry.stateKey !== coreStateKey)) {
    diagnostics.blockedStale++;
    diagnostics.lastReason = 'stale-state-key';
    return insufficient(entry, 'A recomendação pertence a um snapshot anterior e foi descartada.', core);
  }

  const requiredAction = DECISION_TO_ACTION[entry.decision];
  const legal = new Set((core.actions || []).map((action) => action?.type).filter(Boolean));
  if (!requiredAction || !legal.has(requiredAction)) {
    diagnostics.blockedIllegal++;
    diagnostics.lastReason = `illegal:${requiredAction || entry.decision}`;
    return insufficient(entry, 'A recomendação não existe entre os botões físicos atuais e foi descartada.', core);
  }

  diagnostics.accepted++;
  diagnostics.lastReason = 'accepted-current-core';
  const mode = String(entry.source || '').includes('fundamental') ? 'LINHA FUNDAMENTAL' : 'RANGE/HISTÓRICO REFINADO';
  const incomingConfidence = Number(entry.confidence) || core.confidence;
  return {
    ...entry,
    confidence: Math.max(1, Math.min(core.confidence, incomingConfidence)),
    details: `${mode} · núcleo atual ${core.confidence}% · ${entry.details || 'estado atual confirmado'}`,
    currentCore: true,
    coreConfidence: core.confidence,
  };
});

if (typeof window !== 'undefined') {
  window.__prcDecisionCoreGateR14 = diagnostics;
}
