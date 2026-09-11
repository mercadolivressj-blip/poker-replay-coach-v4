function cloneCards(cards = []) { return cards.map((c) => ({ ...c })); }
function normSuit(s) {
  const v = String(s || '').toLowerCase();
  return ['clubs','diamonds','hearts','spades'].includes(v) ? v : null;
}
function weight(card) {
  const conf = Number(card?.suitConfidence);
  const base = Number.isFinite(conf) ? Math.max(0.1, Math.min(1, conf)) : 0.1;
  const pips = Math.max(0, Number(card?.pipCount) || 0);
  return base * (1 + Math.min(0.35, pips * 0.08));
}

export class SuitConsensus {
  constructor({ windowMs = 360 } = {}) {
    this.windowMs = windowMs;
    this.resetSession();
  }
  resetSession() { this.handId = 0; this.samples = [[], []]; this.confirmed = [null, null]; }
  resetHand(handId) { this.handId = handId; this.samples = [[], []]; this.confirmed = [null, null]; }

  observe(cards, { handId, now = performance.now() } = {}) {
    if (!Number.isInteger(handId) || handId !== this.handId || !Array.isArray(cards) || cards.length !== 2) {
      return { cards: cloneCards(cards), confirmedCount: this.confirmed.filter(Boolean).length, stale: true };
    }
    for (let i = 0; i < 2; i++) {
      if (this.confirmed[i]) continue;
      const suit = normSuit(cards[i]?.suit);
      if (!suit) continue;
      this.samples[i].push({ suit, at: now, w: weight(cards[i]), conf: Number(cards[i]?.suitConfidence) || 0, pips: Number(cards[i]?.pipCount) || 0 });
      this.samples[i] = this.samples[i].filter((s) => now - s.at <= this.windowMs).slice(-8);

      const buckets = new Map();
      for (const s of this.samples[i]) {
        const b = buckets.get(s.suit) || { suit: s.suit, hits: 0, score: 0, strong: 0, multi: 0 };
        b.hits++; b.score += s.w;
        if (s.conf >= 0.86) b.strong++;
        if (s.pips >= 2) b.multi++;
        buckets.set(s.suit, b);
      }
      const ranked = [...buckets.values()].sort((a,b) => b.score - a.score || b.hits - a.hits);
      const best = ranked[0];
      const second = ranked[1];
      if (!best) continue;
      const dominant = !second || best.score >= second.score * 1.6;
      const enough = best.hits >= 2 || best.strong >= 2 || (best.multi >= 1 && best.strong >= 1);
      if (dominant && enough) this.confirmed[i] = best.suit;
    }

    const out = cloneCards(cards);
    for (let i = 0; i < 2; i++) {
      out[i].suit = this.confirmed[i] || null;
      if (this.confirmed[i]) out[i].suitSource = 'suit-consensus';
    }
    return { cards: out, confirmedCount: this.confirmed.filter(Boolean).length, suits: [...this.confirmed] };
  }

  snapshot() { return { handId: this.handId, confirmed: [...this.confirmed], sampleCounts: this.samples.map((s) => s.length) }; }
}
