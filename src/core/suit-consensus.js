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
function candidateWeight(card) {
  const conf = Number(card?.suitCandidateConfidence);
  const margin = Number(card?.suitMargin);
  const quality = Number.isFinite(conf) ? conf : 0;
  return Math.max(0.08, quality * 0.58 + Math.max(0, margin) * 0.9);
}
function pairCandidate(card) {
  const suit = normSuit(card?.suitCandidate);
  const confidence = Number(card?.suitCandidateConfidence);
  const margin = Number(card?.suitMargin);
  const distance = Number(card?.suitDistance);
  if (!suit || !Number.isFinite(confidence) || !Number.isFinite(margin) || !Number.isFinite(distance)) return null;
  if (confidence < 0.36 || margin < 0.01 || distance > 0.62) return null;
  return { suit, confidence, margin, distance };
}

export class SuitConsensus {
  constructor({ windowMs = 360, slots = 2, allowFacePairCandidates = false } = {}) {
    this.windowMs = windowMs;
    this.slots = Math.max(1, Math.floor(slots));
    this.allowFacePairCandidates = Boolean(allowFacePairCandidates);
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
    const incomingRanks = cards.map((c) => normRank(c?.rank));
    const sameFacePair = this.allowFacePairCandidates && cards.length === 2 && incomingRanks[0] && incomingRanks[0] === incomingRanks[1] && faceRank(incomingRanks[0]);

    for (let i = 0; i < cards.length; i++) {
      const rank = incomingRanks[i];
      if (rank && this.ranks[i] && rank !== this.ranks[i]) {
        this.samples[i] = [];
        this.confirmed[i] = null;
      }
      if (rank) this.ranks[i] = rank;
      if (this.confirmed[i]) continue;

      let suit = normSuit(cards[i]?.suit);
      let soft = false;
      let conf = Number(cards[i]?.suitConfidence) || 0;
      let w = weight(cards[i]);
      if (!suit && sameFacePair) {
        const candidate = pairCandidate(cards[i]);
        if (candidate) {
          suit = candidate.suit;
          soft = true;
          conf = candidate.confidence;
          w = candidateWeight(cards[i]);
        }
      }
      if (!suit) continue;

      this.samples[i].push({ suit, at: now, w, conf, votes: Number(cards[i]?.voteCount) || 0, soft });
      this.samples[i] = this.samples[i].filter((s) => now - s.at <= this.windowMs).slice(-10);

      const buckets = new Map();
      for (const s of this.samples[i]) {
        const b = buckets.get(s.suit) || { suit: s.suit, hits: 0, hardHits: 0, softHits: 0, score: 0, strong: 0, voted: 0, confSum: 0 };
        b.hits++; b.score += s.w; b.confSum += s.conf;
        if (s.soft) b.softHits++; else b.hardHits++;
        if (!s.soft && s.conf >= 0.84) b.strong++;
        if (!s.soft && s.votes >= 2) b.voted++;
        buckets.set(s.suit, b);
      }
      const ranked = [...buckets.values()].sort((a,b) => b.score - a.score || b.hits - a.hits);
      const best = ranked[0];
      const second = ranked[1];
      if (!best) continue;
      const dominant = !second || best.score >= second.score * 1.55;
      const isFace = faceRank(this.ranks[i]);
      const enough = isFace
        ? best.hardHits >= 3 && best.strong >= 2
        : best.hardHits >= 2 && (best.strong >= 1 || best.score >= 1.25 || best.voted >= 1);
      if (dominant && enough) this.confirmed[i] = best.suit;
    }

    if (sameFacePair) {
      const softBest = (slot) => {
        if (this.confirmed[slot]) return { suit: this.confirmed[slot], ready: true, hard: true };
        const buckets = new Map();
        for (const s of this.samples[slot].filter((x) => x.soft)) {
          const b = buckets.get(s.suit) || { suit: s.suit, hits: 0, score: 0, confSum: 0 };
          b.hits++; b.score += s.w; b.confSum += s.conf; buckets.set(s.suit, b);
        }
        const ranked = [...buckets.values()].sort((a,b) => b.score - a.score || b.hits - a.hits);
        const best = ranked[0], second = ranked[1];
        if (!best) return null;
        const avg = best.confSum / Math.max(1, best.hits);
        const dominant = !second || best.score >= second.score * 1.45;
        return { suit: best.suit, ready: dominant && best.hits >= 4 && avg >= 0.42, hard: false };
      };
      const a = softBest(0), b = softBest(1);
      if (a?.ready && b?.ready && a.suit !== b.suit) {
        if (!this.confirmed[0]) this.confirmed[0] = a.suit;
        if (!this.confirmed[1]) this.confirmed[1] = b.suit;
      }
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
