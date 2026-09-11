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

function sourceWeight(source) {
  if (source === 'teacher') return 1.65;
  if (source === 'refiner-ocr') return 1.5;
  if (source === 'refiner') return 1.35;
  if (source === 'ocr') return 1.12;
  if (source === 'fast') return 0.82;
  return 1;
}

function sourcePriority(source) {
  if (source === 'teacher') return 5;
  if (source === 'refiner-ocr') return 4;
  if (source === 'refiner') return 3;
  if (source === 'ocr') return 2;
  if (source === 'fast') return 1;
  return 0;
}

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
    this.samples = this.samples.filter((s) => now - s.at <= this.windowMs).slice(-12);

    const byKey = new Map();
    for (const sample of this.samples) {
      const bucket = byKey.get(sample.key) || {
        key: sample.key,
        hits: 0,
        weighted: 0,
        strongHits: 0,
        teacherHits: 0,
        refinerHits: 0,
        refinerStrongHits: 0,
        ocrStrongHits: 0,
        fastHits: 0,
        best: sample,
      };
      bucket.hits++;
      bucket.weighted += Math.max(0.15, sample.confidence) * sourceWeight(sample.source);
      if (sample.confidence >= this.strongConfidence) bucket.strongHits++;
      if (sample.source === 'teacher') bucket.teacherHits++;
      if (sample.source === 'fast') bucket.fastHits++;
      if (sample.source === 'refiner' || sample.source === 'refiner-ocr') {
        bucket.refinerHits++;
        if (sample.confidence >= this.strongConfidence) bucket.refinerStrongHits++;
      }
      if ((sample.source === 'ocr' || sample.source === 'refiner-ocr') && sample.confidence >= this.strongConfidence) bucket.ocrStrongHits++;
      const bestPriority = sourcePriority(bucket.best.source);
      const samplePriority = sourcePriority(sample.source);
      if (samplePriority > bestPriority || (samplePriority === bestPriority && sample.confidence > bucket.best.confidence)) bucket.best = sample;
      byKey.set(sample.key, bucket);
    }

    const ranked = [...byKey.values()].sort((a, b) => b.weighted - a.weighted || b.hits - a.hits);
    let best = ranked[0];
    if (!best) return { accepted: false, reason: 'no-candidate' };

    const trustedRefiner = ranked
      .filter((b) => b.refinerStrongHits >= 3)
      .sort((a, b) => b.refinerStrongHits - a.refinerStrongHits || b.weighted - a.weighted)[0];
    if (trustedRefiner) {
      best = trustedRefiner;
      this.committed = { key: best.key, cards: cloneCards(best.best.cards), authority: 'refiner' };
      this.committedAt = now;
      return { accepted: true, changed: true, reason: 'refiner-consensus', cards: cloneCards(this.committed.cards), key: best.key };
    }

    const secondWeight = ranked.find((b) => b.key !== best.key)?.weighted || 0;
    const dominant = best.weighted >= Math.max(0.01, secondWeight * 1.55);
    const fastOnly = best.fastHits === best.hits;
    // R8 fail-closed rule: explicit fast-path samples may hint at a rank but can
    // never become authoritative alone. Generic local samples remain valid for
    // backwards-compatible unit fixtures; the shipped fast path is tagged fast.
    const trustedEvidence = best.fastHits === 0 || best.refinerHits > 0 || best.ocrStrongHits > 0 || best.teacherHits > 0;
    const enough = !fastOnly && trustedEvidence && (
      best.strongHits >= 3 || best.hits >= 4 || best.ocrStrongHits >= 2 || (best.teacherHits >= 1 && best.hits >= 2)
    );
    if (!dominant || !enough) {
      return {
        accepted: false,
        reason: fastOnly ? 'awaiting-refiner' : 'collecting',
        candidate: best.key,
        hits: best.hits,
        strongHits: best.strongHits,
        refinerStrongHits: best.refinerStrongHits,
      };
    }

    this.committed = { key: best.key, cards: cloneCards(best.best.cards), authority: 'mixed' };
    this.committedAt = now;
    return { accepted: true, changed: true, reason: 'consensus', cards: cloneCards(this.committed.cards), key: best.key };
  }

  snapshot() {
    return { handId: this.handId, committed: this.committed ? { key: this.committed.key, cards: cloneCards(this.committed.cards), authority: this.committed.authority || null } : null, sampleCount: this.samples.length };
  }
}

export { cardKey, avgConfidence };
