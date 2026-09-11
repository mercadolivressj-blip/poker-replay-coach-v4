function normRank(rank) {
  const r = rank ? String(rank).toUpperCase() : null;
  return ['2','3','4','5','6','7','8','9','T','J','Q','K','A'].includes(r) ? r : null;
}

function clone(card) { return card ? { ...card } : null; }

export class BoardCardConsensus {
  constructor({ slots = 5, windowMs = 420, minHits = 3 } = {}) {
    this.slots = Math.max(3, Math.min(5, Math.floor(slots)));
    this.windowMs = windowMs;
    this.minHits = Math.max(2, Math.floor(minHits));
    this.resetSession();
  }

  blank() {
    return {
      samples: Array.from({ length: this.slots }, () => []),
      confirmed: Array.from({ length: this.slots }, () => null),
    };
  }

  resetSession() { this.handId = 0; Object.assign(this, this.blank()); }
  resetHand(handId) { this.handId = handId; Object.assign(this, this.blank()); }

  observe(cards, { handId, now = performance.now() } = {}) {
    if (!Number.isInteger(handId) || handId !== this.handId || !Array.isArray(cards) || cards.length > this.slots) {
      return { ready: false, cards: [], confirmedCount: this.confirmed.filter(Boolean).length, stale: true };
    }

    for (let i = 0; i < cards.length; i++) {
      if (this.confirmed[i]) continue;
      const rank = normRank(cards[i]?.rank);
      if (!rank) continue;
      const confidence = Number(cards[i]?.confidence) || 0;
      this.samples[i].push({ rank, confidence, at: now, card: clone(cards[i]) });
      this.samples[i] = this.samples[i].filter((s) => now - s.at <= this.windowMs).slice(-10);

      const buckets = new Map();
      for (const s of this.samples[i]) {
        const b = buckets.get(s.rank) || { rank: s.rank, hits: 0, weighted: 0, strong: 0, best: s };
        b.hits++;
        b.weighted += Math.max(0.2, s.confidence);
        if (s.confidence >= 0.82) b.strong++;
        if (s.confidence > b.best.confidence) b.best = s;
        buckets.set(s.rank, b);
      }
      const ranked = [...buckets.values()].sort((a, b) => b.weighted - a.weighted || b.hits - a.hits);
      const best = ranked[0], second = ranked[1];
      if (!best) continue;
      const dominant = !second || best.weighted >= second.weighted * 1.35;
      const enough = best.hits >= this.minHits && (best.strong >= 1 || best.weighted >= this.minHits * 0.62);
      if (dominant && enough) this.confirmed[i] = { rank: best.rank, card: clone(best.best.card) };
    }

    const out = [];
    for (let i = 0; i < cards.length; i++) {
      const c = this.confirmed[i];
      if (!c) continue;
      // Rank consensus owns only the rank. Keep the latest live card metadata
      // (especially suitCandidate/suitConfidence) so the downstream suit
      // consensus can continue accumulating evidence after rank lock.
      out[i] = { ...c.card, ...cards[i], rank: c.rank };
    }
    const confirmedCount = this.confirmed.slice(0, cards.length).filter(Boolean).length;
    return { ready: confirmedCount === cards.length, cards: out, confirmedCount, ranks: this.confirmed.slice(0, cards.length).map((c) => c?.rank || null) };
  }

  snapshot() {
    return {
      handId: this.handId,
      ranks: this.confirmed.map((c) => c?.rank || null),
      sampleCounts: this.samples.map((s) => s.length),
    };
  }
}
