const numberParts = (value) => {
  if (value == null) return [];
  return String(value).match(/\d+(?:[.,]\d+)*/g) ?? [];
};

export function parseChips(value) {
  const parts = numberParts(value);
  if (!parts.length) return null;
  let raw = parts[parts.length - 1];
  if (raw.includes(',') && raw.includes('.')) {
    // Last separator is assumed decimal; the other is thousands.
    const lastComma = raw.lastIndexOf(',');
    const lastDot = raw.lastIndexOf('.');
    if (lastComma > lastDot) raw = raw.replace(/\./g, '').replace(',', '.');
    else raw = raw.replace(/,/g, '');
  } else if (raw.includes(',')) {
    const chunks = raw.split(',');
    raw = chunks.length === 2 && chunks[1].length <= 2 ? `${chunks[0]}.${chunks[1]}` : chunks.join('');
  } else if ((raw.match(/\./g) ?? []).length > 1) {
    raw = raw.replace(/\./g, '');
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseBlinds(value) {
  const parts = numberParts(value);
  if (parts.length < 2) return null;
  const parseOne = (raw) => {
    const s = String(raw).replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const sb = parseOne(parts[0]);
  const bb = parseOne(parts[1]);
  if (!(sb > 0) || !(bb > 0)) return null;
  return { sb, bb };
}

export function potOdds(potValue, callValue) {
  const pot = parseChips(potValue);
  const call = parseChips(callValue);
  if (!(pot >= 0) || !(call > 0)) return null;
  const finalPot = pot + call;
  return {
    pot,
    call,
    finalPot,
    requiredEquity: finalPot > 0 ? (call / finalPot) * 100 : null,
  };
}

export function effectiveStack(heroValue, effectiveValue) {
  const hero = parseChips(heroValue);
  const eff = parseChips(effectiveValue);
  if (hero == null && eff == null) return null;
  if (hero == null) return eff;
  if (eff == null) return hero;
  return Math.min(hero, eff);
}

export function effectiveDepthBB(heroValue, effectiveValue, blindsValue) {
  const stack = effectiveStack(heroValue, effectiveValue);
  const blinds = parseBlinds(blindsValue);
  if (!(stack > 0) || !blinds || !(blinds.bb > 0)) return null;
  return stack / blinds.bb;
}

export function spr(potValue, heroValue, effectiveValue) {
  const pot = parseChips(potValue);
  const stack = effectiveStack(heroValue, effectiveValue);
  if (!(pot > 0) || !(stack >= 0)) return null;
  const value = stack / pot;
  return { value, regime: value <= 2 ? 'baixo' : value <= 6 ? 'medio' : 'alto' };
}

export function outsEquity(outs, street) {
  if (!(outs > 0)) return 0;
  if (street === 'flop') return Math.min(100, outs * 4);
  if (street === 'turn') return Math.min(100, outs * 2);
  return 0;
}

export function bluffCatchBreakeven(potValue, callValue) {
  const o = potOdds(potValue, callValue);
  return o?.requiredEquity ?? null;
}

export function foldEquityNeeded(potValue, riskValue) {
  const pot = parseChips(potValue);
  const risk = parseChips(riskValue);
  if (!(pot > 0) || !(risk > 0)) return null;
  return (risk / (pot + risk)) * 100;
}

export const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
