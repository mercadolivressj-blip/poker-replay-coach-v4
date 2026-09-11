function cardKey(cards = []) {
  if (!Array.isArray(cards) || cards.length !== 2 || cards.some((c) => !c?.rank)) return null;
  return cards.map((c) => String(c.rank).toUpperCase()).join('');
}

function avgConfidence(cards = []) {
  const vals = cards.map((c) => Number(c?.confidence)).filter(Number.isFinite);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function cloneCards(cards = []) {
  return cards.map((c) => ({ ...c }));
}

export class HeroCardConsensus {
  constructor({ windowMs = 420, strongConfidence = 0.78 } = {}) {
    this.windowMs = windowMs;
    this.strongConfidence = strongConfidence;
    this.resetSession();
  }

  resetSession() {
    this.handId = 0;
    this.samples = [];
    this.committed = null;
    this.committedAt = 0;
  }

  resetHand(handId) {
    this.handId = handId;
    this.samples = [];
    this.committed = null;
    this.committedAt = 0;
  }

  observe(cards, { handId, now = performance.now(), source = 'local' } = {}) {
    if (!Number.isInteger(handId) || handId !== this.handId) return { accepted: false, reason: 'stale-hand' };
    const key = cardKey(cards);
    if (!key) return { accepted: false, reason: 'incomplete' };

    if (this.committed) {
      return {
        accepted: this.committed.key === key,
        changed: false,
        reason: this.committed.key === key ? 'already-committed' : 'sticky-mismatch',
        cards: cloneCards(this.committed.cards),
        key: this.committed.key,
      };
    }

    const confidence = avgConfidence(cards);
    this.samples.push({ key, cards: cloneCards(cards), confidence, source, at: now });
    this.samples = this.samples.filter((s) => now - s.at <= this.windowMs).slice(-8);

    const byKey = new Map();
    for (const sample of this.samples) {
      const bucket = byKey.get(sample.key) || { key: sample.key, hits: 0, weighted: 0, strongHits: 0, best: sample };
      bucket.hits++;
      const sourceBonus = sample.source === 'teacher' ? 1.35 : sample.source === 'ocr' ? 1.12 : 1;
      bucket.weighted += Math.max(0.15, sample.confidence) * sourceBonus;
      if (sample.confidence >= this.strongConfidence || sample.source === 'teacher') bucket.strongHits++;
      if (sample.confidence > bucket.best.confidence) bucket.best = sample;
      byKey.set(sample.key, bucket);
    }

    const ranked = [...byKey.values()].sort((a, b) => b.weighted - a.weighted || b.hits - a.hits);
    const best = ranked[0];
    if (!best) return { accepted: false, reason: 'no-candidate' };
    const secondWeight = ranked[1]?.weighted || 0;
    const dominant = best.weighted >= secondWeight * 1.45;
    const enough = best.strongHits >= 2 || best.hits >= 3 || (best.best.source === 'teacher' && best.best.confidence >= 0.82);
    if (!dominant || !enough) {
      return { accepted: false, reason: 'collecting', candidate: best.key, hits: best.hits, strongHits: best.strongHits };
    }

    this.committed = { key: best.key, cards: cloneCards(best.best.cards) };
    this.committedAt = now;
    return { accepted: true, changed: true, reason: 'consensus', cards: cloneCards(this.committed.cards), key: best.key };
  }

  snapshot() {
    return {
      handId: this.handId,
      committed: this.committed ? { key: this.committed.key, cards: cloneCards(this.committed.cards) } : null,
      sampleCount: this.samples.length,
    };
  }
}

export { cardKey, avgConfidence };
