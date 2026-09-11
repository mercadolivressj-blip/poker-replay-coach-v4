function cloneCards(cards = []) { return cards.map((c) => ({ ...c })); }
function normSuit(s) {
  const v = String(s || '').toLowerCase();
  return ['clubs','diamonds','hearts','spades'].includes(v) ? v : null;
}
function normRank(r) { return r ? String(r).toUpperCase() : null; }
function faceRank(r) { return ['A','J','Q','K'].includes(normRank(r)); }
function weight(card) {
  const conf = Number(card?.suitConfidence);
  const base = Number.isFinite(conf) ? Math.max(0.1, Math.min(1, conf)) : 0.1;
  const votes = Math.max(0, Number(card?.voteCount) || Number(card?.pipCount) || 0);
  return base * (1 + Math.min(0.3, votes * 0.07));
}

export class SuitConsensus {
  constructor({ windowMs = 360, slots = 2 } = {}) {
    this.windowMs = windowMs;
    this.slots = Math.max(1, Math.floor(slots));
    this.resetSession();
  }
  blank() {
    return {
      samples: Array.from({ length: this.slots }, () => []),
      confirmed: Array.from({ length: this.slots }, () => null),
      ranks: Array.from({ length: this.slots }, () => null),
    };
  }
  resetSession() { this.handId = 0; Object.assign(this, this.blank()); }
  resetHand(handId) { this.handId = handId; Object.assign(this, this.blank()); }

  observe(cards, { handId, now = performance.now() } = {}) {
    if (!Number.isInteger(handId) || handId !== this.handId || !Array.isArray(cards) || cards.length > this.slots) {
      return { cards: cloneCards(cards), confirmedCount: this.confirmed.filter(Boolean).length, stale: true };
    }
    for (let i = 0; i < cards.length; i++) {
      const rank = normRank(cards[i]?.rank);
      if (rank && this.ranks[i] && rank !== this.ranks[i]) {
        this.samples[i] = [];
        this.confirmed[i] = null;
      }
      if (rank) this.ranks[i] = rank;
      if (this.confirmed[i]) continue;
      const suit = normSuit(cards[i]?.suit);
      if (!suit) continue;
      this.samples[i].push({ suit, at: now, w: weight(cards[i]), conf: Number(cards[i]?.suitConfidence) || 0, votes: Number(cards[i]?.voteCount) || 0 });
      this.samples[i] = this.samples[i].filter((s) => now - s.at <= this.windowMs).slice(-8);

      const buckets = new Map();
      for (const s of this.samples[i]) {
        const b = buckets.get(s.suit) || { suit: s.suit, hits: 0, score: 0, strong: 0, voted: 0 };
        b.hits++; b.score += s.w;
        if (s.conf >= 0.84) b.strong++;
        if (s.votes >= 2) b.voted++;
        buckets.set(s.suit, b);
      }
      const ranked = [...buckets.values()].sort((a,b) => b.score - a.score || b.hits - a.hits);
      const best = ranked[0];
      const second = ranked[1];
      if (!best) continue;
      const dominant = !second || best.score >= second.score * 1.55;
      const isFace = faceRank(this.ranks[i]);
      // Face/ace cards expose only the authoritative corner glyph. Require three
      // agreeing frames so a single decorative face/watermark region can never
      // become sticky after just two repeated mistakes. Numeric cards can use
      // repeated pip votes and keep the faster two-frame confirmation.
      const enough = isFace
        ? best.hits >= 3 && best.strong >= 2
        : best.hits >= 2 && (best.strong >= 1 || best.score >= 1.25 || best.voted >= 1);
      if (dominant && enough) this.confirmed[i] = best.suit;
    }

    const out = cloneCards(cards);
    for (let i = 0; i < out.length; i++) {
      out[i].suit = this.confirmed[i] || null;
      if (this.confirmed[i]) out[i].suitSource = 'suit-consensus';
    }
    return { cards: out, confirmedCount: this.confirmed.filter(Boolean).length, suits: this.confirmed.slice(0, cards.length) };
  }

  snapshot() {
    return { handId: this.handId, confirmed: [...this.confirmed], ranks: [...this.ranks], sampleCounts: this.samples.map((s) => s.length) };
  }
}
