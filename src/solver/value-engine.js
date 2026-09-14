function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function amountOf(action, fallback = null) { return Number.isFinite(action?.amount) && action.amount >= 0 ? action.amount : fallback; }

function foldEquity(rangeSummary, risk, pot, street, actionType, evidenceQuality = 0, actorKnown = false) {
  const strong = clamp(Number(rangeSummary?.strongShare) || 0, 0, 1);
  const draw = clamp(Number(rangeSummary?.drawShare) || 0, 0, 1);
  const air = clamp(Number(rangeSummary?.airShare) || 0, 0, 1);
  const other = clamp(1 - strong - Math.max(0, air), 0, 1);
  const riverMissedDraw = street === 'river' ? draw * 0.65 : draw * 0.20;
  const foldable = clamp(air + other * 0.36 + riverMissedDraw - strong * 0.10, 0.03, 0.86);
  const pressure = Number.isFinite(risk) && Number.isFinite(pot) && pot > 0 ? clamp(risk / (pot + risk), 0, 1) : 0.33;
  const aggression = actionType === 'allin' ? 1.18 : actionType === 'raise' ? 1.08 : 1;
  const evidenceScale = actorKnown ? (0.38 + clamp(evidenceQuality, 0, 1) * 0.62) : (0.18 + clamp(evidenceQuality, 0, 1) * 0.32);
  const headsUp = clamp(foldable * (0.52 + pressure * 0.72) * aggression * evidenceScale, 0.01, actorKnown ? 0.80 : 0.34);

  const opponents = Math.max(1, Math.min(5, Math.round(Number(rangeSummary?.rangeCount) || 1)));
  if (opponents <= 1) return headsUp;
  return clamp(Math.pow(headsUp, opponents), 0.002, 0.38);
}

function callEv(equity, pot, call) {
  if (!Number.isFinite(call) || call < 0) return null;
  return equity * pot - (1 - equity) * call;
}

function aggressionEv(equity, pot, risk, fe, actionType, evidenceQuality = 0) {
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const calledEquityPenalty = actionType === 'allin' ? 0.085 : actionType === 'raise' ? 0.065 : 0.04;
  const eqWhenCalled = clamp(equity - calledEquityPenalty, 0.01, 0.99);
  const calledEv = fe * pot + (1 - fe) * (eqWhenCalled * (pot + risk) - (1 - eqWhenCalled) * risk);
  const uncertaintyPenalty = risk * (1 - clamp(evidenceQuality, 0, 1)) * (actionType === 'allin' ? 0.12 : actionType === 'raise' ? 0.085 : 0.06);
  return calledEv - uncertaintyPenalty;
}

export function estimateActionValues({
  equity,
  pot,
  actions = [],
  rangeSummary = null,
  street = 'preflop',
  effectiveStack = null,
  evidenceQuality = 0,
  actorKnown = false,
  allowGenericCall = false,
} = {}) {
  if (!Number.isFinite(equity) || !Number.isFinite(pot) || pot < 0) return [];

  // The refined resolver still fails closed when a call would be evaluated
  // against an unidentified actor. The R14 fundamental core may explicitly opt
  // into a conservative population-range call when current pot, price, stacks,
  // players and action buttons are all confirmed.
  if (actions.some((action) => action?.type === 'call') && !actorKnown && !allowGenericCall) return [];

  const out = [];
  for (const action of actions) {
    const type = action?.type;
    if (type === 'fold') {
      out.push({ action: type, ev: 0, risk: 0, foldEquity: 0, note: 'Fold preserva o stack e encerra o investimento adicional.' });
      continue;
    }
    if (type === 'check') {
      const streetFactor = street === 'river' ? 0.88 : street === 'turn' ? 0.68 : street === 'flop' ? 0.58 : 0.50;
      const uncertaintyFactor = 0.86 + clamp(evidenceQuality, 0, 1) * 0.14;
      out.push({ action: type, ev: equity * pot * streetFactor * uncertaintyFactor, risk: 0, foldEquity: 0, note: 'Check mantém o range amplo; valor é estimado sem inventar ação futura.' });
      continue;
    }
    if (type === 'call') {
      const risk = amountOf(action, null);
      const ev = callEv(equity, pot, risk);
      if (ev !== null) out.push({ action: type, ev, risk, foldEquity: 0, note: allowGenericCall && !actorKnown ? 'Call usa equity populacional conservadora e o preço atual confirmado.' : 'Call usa equity estimada contra o range e o preço observado.' });
      continue;
    }
    if (['bet', 'raise', 'allin'].includes(type)) {
      const fallback = Number.isFinite(effectiveStack) ? (type === 'allin' ? effectiveStack : Math.min(effectiveStack, Math.max(1, pot * (type === 'raise' ? 0.75 : 0.6)))) : Math.max(1, pot * (type === 'raise' ? 0.75 : 0.6));
      const risk = amountOf(action, fallback);
      const fe = foldEquity(rangeSummary, risk, pot, street, type, evidenceQuality, actorKnown);
      const ev = aggressionEv(equity, pot, risk, fe, type, evidenceQuality);
      if (ev !== null) out.push({ action: type, ev, risk, foldEquity: fe, note: actorKnown ? 'Linha agressiva combina fold equity reconstruída com equity quando recebe call.' : 'Agressão penalizada porque o rival/linha ainda não está bem reconstruído.' });
    }
  }
  return out.sort((a, b) => b.ev - a.ev);
}

export function valueGap(values, scale = 1) {
  if (!Array.isArray(values) || !values.length) return 0;
  if (values.length === 1) return 1;
  return clamp((values[0].ev - values[1].ev) / Math.max(1, scale), 0, 1);
}
