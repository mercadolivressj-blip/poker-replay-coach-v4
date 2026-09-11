const AGGRO = new Set(['bet','raise','allin']);

function actorKey(name, seatLabel = null) {
  return String(name || seatLabel || '').trim().toLowerCase();
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export class OpponentStatsStore {
  constructor() { this.players = new Map(); this.seenHandActor = new Set(); }

  resetSession() { this.players.clear(); this.seenHandActor.clear(); }

  observeHand(handId, events = []) {
    if (!Number.isInteger(handId)) return 0;
    const grouped = new Map();
    for (const e of events) {
      const key = actorKey(e.actorName, e.seatLabel);
      if (!key) continue;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(e);
    }
    let updated = 0;
    for (const [key, line] of grouped) {
      const dedupe = `${handId}:${key}`;
      if (this.seenHandActor.has(dedupe)) continue;
      this.seenHandActor.add(dedupe);
      const p = this.players.get(key) || {
        key,
        actorName: line.find((e) => e.actorName)?.actorName || null,
        seatLabel: line.find((e) => e.seatLabel)?.seatLabel || null,
        hands: 0,
        vpipHands: 0,
        pfrHands: 0,
        postflopAggro: 0,
        postflopCalls: 0,
        riverAggro: 0,
        riverRaises: 0,
        folds: 0,
      };
      p.hands++;
      const pre = line.filter((e) => e.street === 'preflop');
      if (pre.some((e) => ['call','raise','allin'].includes(e.action))) p.vpipHands++;
      if (pre.some((e) => ['raise','allin'].includes(e.action))) p.pfrHands++;
      for (const e of line) {
        if (e.action === 'fold') p.folds++;
        if (e.street !== 'preflop' && AGGRO.has(e.action)) p.postflopAggro++;
        if (e.street !== 'preflop' && e.action === 'call') p.postflopCalls++;
        if (e.street === 'river' && AGGRO.has(e.action)) p.riverAggro++;
        if (e.street === 'river' && ['raise','allin'].includes(e.action)) p.riverRaises++;
      }
      this.players.set(key, p);
      updated++;
    }
    return updated;
  }

  snapshot(actorName, seatLabel = null) {
    const key = actorKey(actorName, seatLabel);
    const p = this.players.get(key);
    if (!p) return null;
    const vpip = p.hands ? p.vpipHands / p.hands : null;
    const pfr = p.hands ? p.pfrHands / p.hands : null;
    const aggressionFactor = p.postflopAggro / Math.max(1, p.postflopCalls);
    const reliability = clamp((p.hands - 3) / 17, 0, 1);
    const style = classifyStyle({ hands: p.hands, vpip, pfr, aggressionFactor });
    const rawAdjust = bluffPriorFor({ style, aggressionFactor, riverAggro: p.riverAggro, hands: p.hands });
    return {
      ...p,
      vpip,
      pfr,
      aggressionFactor,
      reliability,
      style,
      bluffPriorAdjustment: Math.round(rawAdjust * reliability),
      note: p.hands < 8 ? 'Amostra pequena: tendência ainda não deve dominar a decisão.' : 'Tendência baseada apenas nas mãos observadas neste replay/sessão.',
    };
  }
}

function classifyStyle({ hands, vpip, pfr, aggressionFactor }) {
  if (hands < 8) return 'unknown';
  const loose = vpip >= 0.34;
  const tight = vpip <= 0.22;
  const aggressive = aggressionFactor >= 2.2 || pfr >= 0.22;
  const passive = aggressionFactor <= 0.9 && pfr <= 0.14;
  if (loose && aggressive) return 'loose-aggressive';
  if (tight && aggressive) return 'tight-aggressive';
  if (loose && passive) return 'loose-passive';
  if (tight && passive) return 'tight-passive';
  return aggressive ? 'aggressive' : passive ? 'passive' : 'balanced-unknown';
}

function bluffPriorFor({ style, aggressionFactor, riverAggro, hands }) {
  if (hands < 4) return 0;
  let n = 0;
  if (style === 'loose-aggressive') n += 10;
  else if (style === 'aggressive') n += 6;
  else if (style === 'tight-passive') n -= 10;
  else if (style === 'loose-passive') n -= 6;
  else if (style === 'tight-aggressive') n -= 2;
  if (aggressionFactor >= 4) n += 4;
  if (riverAggro >= Math.max(3, Math.ceil(hands * 0.35))) n += 3;
  return clamp(n, -12, 12);
}
