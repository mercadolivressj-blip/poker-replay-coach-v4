import { effectiveDepthBB } from './math.js';

export function stackRegime(depthBB) {
  if (depthBB == null) return 'unknown';
  if (depthBB <= 8) return 'critical';
  if (depthBB <= 15) return 'short';
  if (depthBB <= 25) return 'medium-short';
  if (depthBB <= 40) return 'medium';
  if (depthBB <= 80) return 'comfortable';
  return 'deep';
}

export function tournamentPhase(context = {}) {
  if (context.stage) return context.stage;
  const remaining = Number(context.playersRemaining);
  const paid = Number(context.paidPlaces);
  if (Number.isFinite(remaining) && Number.isFinite(paid) && paid > 0) {
    if (remaining <= Math.max(9, paid * 0.05)) return 'final-table';
    if (remaining <= paid * 1.08 && remaining > paid) return 'bubble';
    if (remaining <= paid) return 'in-the-money';
  }
  return 'unknown';
}

// This is a CONTEXT heuristic, not an ICM solver. If an explicit risk premium is
// supplied by an external calculator, it always wins.
export function estimatedRiskPremiumPct(context = {}) {
  const explicit = Number(context.icmRiskPremiumPct);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const phase = tournamentPhase(context);
  if (phase === 'bubble') return 8;
  if (phase === 'final-table') return 10;
  if (phase === 'in-the-money') return 3;
  return 0;
}

export function mttContext(state, context = {}) {
  const depthBB = effectiveDepthBB(state.heroStack, state.effectiveStack, state.blinds);
  const phase = tournamentPhase(context);
  const riskPremiumPct = estimatedRiskPremiumPct(context);
  return {
    depthBB,
    stackRegime: stackRegime(depthBB),
    phase,
    riskPremiumPct,
    bountyFactor: Number.isFinite(Number(context.bountyFactor)) ? Number(context.bountyFactor) : null,
    // Calling off chips is affected more by ICM than first-in aggression.
    callThresholdAdjustment: riskPremiumPct,
    firstInAggressionAdjustment: phase === 'bubble' ? -2 : 0,
    confidence: context.icmRiskPremiumPct != null ? 'explicit-context' : 'heuristic-context',
  };
}
