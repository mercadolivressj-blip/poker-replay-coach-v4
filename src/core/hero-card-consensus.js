function cardKey(cards = []) {
  if (!Array.isArray(cards) || cards.length !== 2 || cards.some((c) => !c?.rank)) return null;
  return cards.map((c) => String(c.rank).toUpperCase()).join('');
}

function avgConfidence(cards = []) {
  const vals = cards.map((c) => Number(c?.confidence)).filter(Number.isFinite);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function cloneCards(cards = []) { return cards.map((c) => ({ ...c })); }

function enrichCommitted(base, incoming) {
  return base.map((old, i) => {
    const next = incoming[i] || {};
    const oldConf = Number(old?.confidence) || 0;
    const nextConf = Number(next?.confidence) || 0;
    return {
      ...old,
      suit: next.suit || old.suit || null,
      confidence: Math.max(oldConf, nextConf),
      source: nextConf > oldConf ? (next.source || old.source) : old.source,
    };
  });
}

export class HeroCardConsensus {
  constructor({ windowMs = 460, strongConfidence = 0.78 } = {}) {
    this.windowMs = windowMs;
    this.strongConfidence = strongConfidence;
    this.resetSession();
  }

  resetSession() { this.handId = 0; this.samples = []; this.committed = null; this.committedAt = 0; }
  resetHand(handId) { this.handId = handId; this.samples = []; this.committed = null; this.committedAt = 0; }

  observe(cards, { handId, now = performance.now(), source = 'local' } = {}) {
    if (!Number.isInteger(handId) || handId !== this.handId) return { accepted: false, reason: 'stale-hand' };
    const key = cardKey(cards);
    if (!key) return { accepted: false, reason: 'incomplete' };

    if (this.committed) {
      if (this.committed.key !== key) {
        return { accepted: false, changed: false, reason: 'sticky-mismatch', cards: cloneCards(this.committed.cards), key: this.committed.key };
      }
      this.committed.cards = enrichCommitted(this.committed.cards, cards);
      return { accepted: true, changed: false, reason: 'already-committed', cards: cloneCards(this.committed.cards), key };
    }

    const confidence = avgConfidence(cards);
    this.samples.push({ key, cards: cloneCards(cards), confidence, source, at: now });
    this.samples = this.samples.filter((s) => now - s.at <= this.windowMs).slice(-10);

    const byKey = new Map();
    for (const sample of this.samples) {
      const bucket = byKey.get(sample.key) || { key: sample.key, hits: 0, weighted: 0, strongHits: 0, teacherHits: 0, best: sample };
      bucket.hits++;
      const sourceBonus = sample.source === 'teacher' ? 1.45 : sample.source === 'ocr' ? 1.12 : 1;
      bucket.weighted += Math.max(0.15, sample.confidence) * sourceBonus;
      if (sample.confidence >= this.strongConfidence) bucket.strongHits++;
      if (sample.source === 'teacher') bucket.teacherHits++;
      if (sample.confidence > bucket.best.confidence || sample.source === 'teacher') bucket.best = sample;
      byKey.set(sample.key, bucket);
    }

    const ranked = [...byKey.values()].sort((a, b) => b.weighted - a.weighted || b.hits - a.hits);
    const best = ranked[0];
    if (!best) return { accepted: false, reason: 'no-candidate' };
    const secondWeight = ranked[1]?.weighted || 0;
    const dominant = best.weighted >= Math.max(0.01, secondWeight * 1.55);
    const enough = best.strongHits >= 3 || best.hits >= 4 || (best.teacherHits >= 1 && best.hits >= 2);
    if (!dominant || !enough) {
      return { accepted: false, reason: 'collecting', candidate: best.key, hits: best.hits, strongHits: best.strongHits };
    }

    this.committed = { key: best.key, cards: cloneCards(best.best.cards) };
    this.committedAt = now;
    return { accepted: true, changed: true, reason: 'consensus', cards: cloneCards(this.committed.cards), key: best.key };
  }

  snapshot() {
    return { handId: this.handId, committed: this.committed ? { key: this.committed.key, cards: cloneCards(this.committed.cards) } : null, sampleCount: this.samples.length };
  }
}

export { cardKey, avgConfidence };
