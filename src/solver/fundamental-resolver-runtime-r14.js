import { getDecision, publishDecision, decisionStateKey } from '../core/decision-store.js';
import { currentDecisionCoreEvidence } from './decision-core-r14.js';
import { buildOpponentRange } from './range-engine.js';
import { estimateEquity, estimateMultiwayEquity } from './equity-engine.js';
import { estimateActionValues, valueGap } from './value-engine.js';
import { recommendUnopenedPreflop } from './preflop-policy-r14.js';

const LABEL = Object.freeze({ fold: 'DESISTIR', check: 'PASSAR', call: 'PAGAR', bet: 'APOSTAR', raise: 'AUMENTAR', allin: 'ALL-IN' });
const STRATEGIC = new Set(Object.values(LABEL));
const REFINEMENT_GRACE_MS = 180;

const diagnostics = {
  enabled: true,
  evaluations: 0,
  publishes: 0,
  unopenedPolicyPublishes: 0,
  populationPublishes: 0,
  lastMode: null,
  lastReason: 'boot',
  lastConfidence: 0,
};

let currentKey = '';
let coreReadyAt = 0;
let cached = null;

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function actorKey(value) {
  return String(value || '').trim().toLowerCase();
}

function rangeAggregate(ranges) {
  const summaries = (ranges || []).map((range) => range?.summary).filter(Boolean);
  if (!summaries.length) return { strongShare: 0, drawShare: 0, airShare: 0, comboCount: 0, rangeCount: 0 };
  const total = summaries.length;
  const avg = (key) => summaries.reduce((sum, summary) => sum + (Number(summary[key]) || 0), 0) / total;
  return {
    strongShare: avg('strongShare'),
    drawShare: avg('drawShare'),
    airShare: avg('airShare'),
    comboCount: summaries.reduce((sum, summary) => sum + (Number(summary.comboCount) || 0), 0),
    rangeCount: total,
  };
}

function currentPriceActor(core) {
  if (core.aggressorName) {
    const exact = core.activeOpponents.find((seat) => actorKey(seat.actorName) === actorKey(core.aggressorName));
    if (exact) return exact;
  }

  const heroCommitted = Number.isFinite(core.heroCommitted) ? Number(core.heroCommitted) : 0;
  return [...core.activeOpponents]
    .filter((seat) => Number.isFinite(seat.committed) && Number(seat.committed) > heroCommitted)
    .sort((a, b) => Number(b.committed) - Number(a.committed))[0] || null;
}

function populationRanges(core) {
  const priceActor = currentPriceActor(core);
  const facingCall = core.actions.some((action) => action.type === 'call');
  const pressureAction = core.street === 'preflop'
    ? 'raise'
    : (Number(core.heroCommitted) > 0 ? 'raise' : 'bet');

  return core.activeOpponents.map((seat, index) => {
    const syntheticName = seat.actorName || `population-seat-${seat.seatIndex ?? index}`;
    const table = {
      seats: core.seats.map((candidate) => candidate === seat || candidate.seatIndex === seat.seatIndex
        ? { ...candidate, actorName: syntheticName }
        : { ...candidate }),
    };
    const isPriceActor = Boolean(priceActor && priceActor.seatIndex === seat.seatIndex);
    const events = facingCall && isPriceActor
      ? [{ street: core.street, actorName: syntheticName, action: pressureAction, amount: core.aggressorCommitted, confidence: core.aggressorKnown ? 0.86 : 0.72 }]
      : [];
    return buildOpponentRange({
      hero: core.hero,
      board: core.board,
      events,
      actorName: syntheticName,
      table,
      maxCombos: core.activeOpponentCount > 1 ? 170 : 280,
    });
  }).filter((range) => Array.isArray(range?.combos) && range.combos.length);
}

function explain(best, equity, core) {
  const eq = Math.round(equity * 100);
  const call = core.actions.find((action) => action.type === 'call');
  const required = call && Number.isFinite(call.amount)
    ? Math.round((call.amount / (core.pot + call.amount)) * 100)
    : null;

  if (best.action === 'call') {
    return `PAGAR · linha fundamental: equity populacional ~${eq}%${required !== null ? ` contra ~${required}% exigidos pelo preço atual` : ''}.`;
  }
  if (best.action === 'fold') {
    return `DESISTIR · linha fundamental: continuar ficou abaixo do fold neste estado atual${required !== null ? `; o preço pede ~${required}% de equity` : ''}.`;
  }
  if (best.action === 'check') {
    return `PASSAR · linha fundamental: com ~${eq}% de equity estimada, não há necessidade de aumentar o risco agora.`;
  }
  if (best.action === 'bet') {
    return `APOSTAR · linha fundamental: ~${eq}% de equity estimada + ~${Math.round((best.foldEquity || 0) * 100)}% de fold equity conservadora.`;
  }
  if (best.action === 'raise') {
    return `AUMENTAR · linha fundamental: ~${eq}% de equity estimada + ~${Math.round((best.foldEquity || 0) * 100)}% de fold equity conservadora.`;
  }
  return `ALL-IN · linha fundamental: ~${eq}% de equity estimada no estado atual.`;
}

function fundamentalConfidence(core, values, equity, actorKnown) {
  const maxRisk = Math.max(0, ...values.map((value) => Number(value.risk) || 0));
  const gap = valueGap(values, Math.max(1, core.pot + maxRisk));
  const stderr = Number(equity?.stderr);
  const sampleCertainty = stderr === 0 ? 1 : Math.max(0, Math.min(1, 1 - (Number.isFinite(stderr) ? stderr : 0.2) * 8));
  let confidence = Math.round(52 + gap * 24 + (core.confidence - 70) * 0.58 + sampleCertainty * 8);
  if (!actorKnown && core.actions.some((action) => action.type === 'call')) confidence = Math.min(confidence, 80);
  if (core.activeOpponentCount > 1) confidence = Math.min(confidence, 79);
  if (core.street === 'preflop' && !['unopened','limped','raised'].includes(core.preflopMode)) confidence = Math.min(confidence, 76);
  return Math.max(66, Math.min(88, confidence));
}

function calculate(core) {
  diagnostics.evaluations++;

  if (core.street === 'preflop' && core.preflopMode === 'unopened') {
    const context = core.preflopContext || {};
    const recommendation = recommendUnopenedPreflop({
      hero: core.hero,
      position: core.heroPosition,
      actions: core.actions,
      pot: core.pot,
      sb: context.sb,
      bb: context.bb,
    });
    if (recommendation?.decision) {
      return {
        decision: LABEL[recommendation.decision] || recommendation.decision.toUpperCase(),
        confidence: Math.min(core.confidence, recommendation.confidence || 82),
        reason: recommendation.reason,
        details: `Linha fundamental por posição · ${recommendation.details} · histórico não é requisito para esta decisão.`,
        mode: 'fundamental-unopened',
      };
    }
  }

  const ranges = populationRanges(core);
  if (!ranges.length) return null;
  const seed = `${core.handId}|${core.street}|${core.hero.map((card) => `${card.rank}${card.suit}`).join(',')}|${core.board.map((card) => `${card.rank}${card.suit}`).join(',')}|${core.pot}|${core.actions.map((action) => `${action.type}:${action.amount ?? '-'}`).join('|')}`;
  const equity = ranges.length > 1
    ? estimateMultiwayEquity({ hero: core.hero, board: core.board, ranges, budget: 820, seed })
    : estimateEquity({ hero: core.hero, board: core.board, range: ranges[0], budget: 620, seed });
  if (!Number.isFinite(equity?.equity)) return null;

  const rangeSummary = rangeAggregate(ranges);
  const priceActor = currentPriceActor(core);
  const actorKnown = Boolean(core.aggressorKnown || priceActor);
  const values = estimateActionValues({
    equity: equity.equity,
    pot: core.pot,
    actions: core.actions,
    rangeSummary,
    street: core.street,
    effectiveStack: core.effectiveStack,
    evidenceQuality: Math.max(0.58, Math.min(0.88, core.confidence / 100 * 0.88)),
    actorKnown,
    allowGenericCall: true,
  });
  if (!values.length) return null;

  const best = values[0];
  const confidence = fundamentalConfidence(core, values, equity, actorKnown);
  return {
    decision: LABEL[best.action] || null,
    confidence,
    reason: explain(best, equity.equity, core),
    details: `Estado atual ${core.confidence}% · ${core.heroPosition || 'posição pós-flop'} · stack efetivo ${Number.isFinite(core.effectiveStack) ? core.effectiveStack : '—'} · ${core.activeOpponentCount} adversário(s) ativo(s) · range populacional fundamental${core.aggressorKnown ? ' · agressor atual conhecido' : ' · histórico/agressor parcial'}.`,
    mode: 'fundamental-population',
    equity: equity.equity,
    values,
    ranges: ranges.length,
  };
}

function tick() {
  const core = currentDecisionCoreEvidence();
  if (!core.ready) {
    currentKey = '';
    coreReadyAt = 0;
    cached = null;
    diagnostics.lastReason = core.reason;
    return;
  }

  const stateKey = decisionStateKey(core.handId, {
    street: core.street,
    hero: core.hero,
    board: core.board,
    pot: core.pot,
    actions: core.actions,
  });
  if (stateKey !== currentKey) {
    currentKey = stateKey;
    coreReadyAt = nowMs();
    cached = null;
  }

  const existing = getDecision();
  if (existing?.finalDecision && STRATEGIC.has(existing.decision)) return;
  if (existing && STRATEGIC.has(existing.decision) && existing.stateKey === stateKey) return;

  // Give the history/range-refined resolver a tiny head start. If it has good
  // evidence it wins; otherwise the current-state fundamental layer answers.
  if (nowMs() - coreReadyAt < REFINEMENT_GRACE_MS) return;

  if (!cached) cached = calculate(core);
  if (!cached?.decision) {
    diagnostics.lastReason = 'fundamental-could-not-resolve';
    return;
  }

  const published = publishDecision({
    stateKey,
    decision: cached.decision,
    reason: cached.reason,
    details: cached.details,
    confidence: cached.confidence,
    source: 'fundamental-core-r14',
    mode: cached.mode,
  });
  if (published?.decision === cached.decision) {
    diagnostics.publishes++;
    if (cached.mode === 'fundamental-unopened') diagnostics.unopenedPolicyPublishes++;
    else diagnostics.populationPublishes++;
    diagnostics.lastMode = cached.mode;
    diagnostics.lastReason = 'published';
    diagnostics.lastConfidence = cached.confidence;
  }
}

if (typeof window !== 'undefined') {
  window.__prcFundamentalResolverR14 = diagnostics;
  window.addEventListener('prc:generation-change', () => {
    currentKey = '';
    coreReadyAt = 0;
    cached = null;
    diagnostics.lastReason = 'generation-change';
  });
  setInterval(tick, 30);
  setTimeout(tick, 0);
}

export { calculate as calculateFundamentalDecision };
