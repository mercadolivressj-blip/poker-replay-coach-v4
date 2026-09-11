import { pairVectorDistance } from './image.js';

export let activeHandMachine = null;

function semanticSlots(v) {
  if (typeof v === 'string' && v.length === 2) return [v[0], v[1]];
  if (Array.isArray(v) && v.length === 2 && v.every((x) => x == null || typeof x === 'string')) return v;
  return null;
}

function heroIdentityDistance(a, b) {
  const sa = semanticSlots(a);
  const sb = semanticSlots(b);
  if (sa && sb) {
    let comparable = 0;
    for (let i = 0; i < 2; i++) {
      if (!sa[i] || !sb[i]) continue;
      comparable++;
      if (sa[i] !== sb[i]) return 1;
    }
    return comparable ? 0 : 0;
  }
  if (typeof a === 'string' || typeof b === 'string') return a === b ? 0 : 1;
  return pairVectorDistance(a, b);
}

function identityConfirmationHits(fp, reappearArmed = false) {
  if (semanticSlots(fp)) return reappearArmed ? 2 : Number.POSITIVE_INFINITY;
  return 2;
}

function mergeStickyHero(current, incoming) {
  return current.map((old, i) => {
    const next = incoming[i] || {};
    const oldSuit = old?.suit || null;
    const nextSuit = next?.suit || null;
    const sameOrMissingSuit = !oldSuit || !nextSuit || oldSuit === nextSuit;
    return {
      ...old,
      ...next,
      rank: old.rank,
      suit: oldSuit || nextSuit || null,
      confidence: Math.max(Number(old?.confidence) || 0, Number(next?.confidence) || 0),
      suitConfidence: sameOrMissingSuit
        ? Math.max(Number(old?.suitConfidence) || 0, Number(next?.suitConfidence) || 0)
        : Number(old?.suitConfidence) || 0,
      source: old?.source || next?.source || null,
    };
  });
}

function mergeStickyBoard(current, incoming) {
  const out = [];
  const keep = Math.min(current.length, incoming.length);
  for (let i = 0; i < keep; i++) {
    const old = current[i] || {};
    const next = incoming[i] || {};
    const oldRank = old?.rank ? String(old.rank).toUpperCase() : null;
    const nextRank = next?.rank ? String(next.rank).toUpperCase() : null;
    if (oldRank && nextRank && oldRank !== nextRank) {
      out.push({ ...old, conflictCandidate: nextRank });
      continue;
    }
    const oldSuit = old?.suit || null;
    const nextSuit = next?.suit || null;
    const suitConflict = oldSuit && nextSuit && oldSuit !== nextSuit;
    out.push({
      ...old,
      ...next,
      rank: old.rank || next.rank,
      suit: suitConflict ? oldSuit : (oldSuit || nextSuit || null),
      confidence: Math.max(Number(old?.confidence) || 0, Number(next?.confidence) || 0),
      suitConfidence: suitConflict
        ? Number(old?.suitConfidence) || 0
        : Math.max(Number(old?.suitConfidence) || 0, Number(next?.suitConfidence) || 0),
      source: old?.source || next?.source || null,
    });
  }
  for (let i = keep; i < incoming.length; i++) out.push({ ...incoming[i] });
  return out;
}

export class HandMachine {
  constructor() { this.resetSession(); activeHandMachine = this; }
  resetSession() {
    this.handId = 0; this.lastFp = null; this.pendingFp = null; this.pendingHits = 0;
    this.heroMissing = 0; this.reappearArmed = false; this.adoptNextHero = false; this.lastHeroSeenAt = 0;
    this.lastBoardCountVisual = 0; this.boardZeroHits = 0; this.boardZeroSince = 0; this.actionMisses = 0;
    this.potResetPending = null; this.potResetHits = 0; this.state = this.blank(0);
  }
  blank(now = performance.now()) {
    return { hero: [], board: [], street: 'preflop', pot: null, actions: [], heroToAct: false, confidence: 0, startedAt: now, reason: 'waiting', provisionalDecision: null };
  }
  newHand(reason, now = performance.now()) {
    this.handId++; this.state = this.blank(now); this.state.reason = reason; this.actionMisses = 0;
    this.boardZeroHits = 0; this.boardZeroSince = 0; this.lastBoardCountVisual = 0; this.potResetPending = null; this.potResetHits = 0;
  }
  observeHero(fp, present, now = performance.now()) {
    if (!present) {
      this.heroMissing++;
      // In PokerStars replay the hole cards disappear briefly between deals.
      // Six half-rate observations was too conservative and often missed fast
      // hand transitions completely. Four misses + 120 ms is still well above a
      // single animation/occlusion frame, but reliably arms the next deal.
      if (this.heroMissing >= 4 && now - this.lastHeroSeenAt >= 120) this.reappearArmed = true;
      return { newHand: false, reason: null };
    }
    if (fp === null || fp === undefined || (Array.isArray(fp) && !fp.length) || fp === '') {
      this.heroMissing = 0; this.lastHeroSeenAt = now; return { newHand: false, reason: 'hero-identity-unknown' };
    }
    const wasMissing = this.heroMissing > 0;
    this.heroMissing = 0; this.lastHeroSeenAt = now;
    if (this.adoptNextHero) {
      this.lastFp = fp; this.pendingFp = null; this.pendingHits = 0; this.reappearArmed = false; this.adoptNextHero = false;
      return { newHand: false, reason: 'hero-adopted-after-board-reset', distance: null };
    }
    if (this.lastFp === null) {
      this.lastFp = fp; this.reappearArmed = false; this.newHand('first-cards', now); return { newHand: true, reason: 'first-cards' };
    }

    // A sustained disappearance followed by two matching observations is a
    // stronger hand-boundary signal than rank comparison. It must work even if
    // the next deal happens to have the same ranks as the previous hand.
    if (this.reappearArmed) {
      if (this.pendingFp && heroIdentityDistance(this.pendingFp, fp) < 0.065) this.pendingHits++;
      else { this.pendingFp = fp; this.pendingHits = 1; }
      if (this.pendingHits >= identityConfirmationHits(fp, true) && now - this.state.startedAt > 120) {
        this.lastFp = fp; this.pendingFp = null; this.pendingHits = 0; this.reappearArmed = false;
        this.newHand('hero-redealt', now);
        return { newHand: true, reason: 'hero-redealt', distance: heroIdentityDistance(this.lastFp, fp) };
      }
      return { newHand: false, reason: 'hero-redeal-confirming', distance: heroIdentityDistance(this.lastFp, fp) };
    }

    const distance = heroIdentityDistance(this.lastFp, fp);
    if (distance < 0.13) {
      this.pendingFp = null; this.pendingHits = 0;
      return { newHand: false, reason: wasMissing ? 'hero-same-reappeared' : null, distance };
    }

    if (semanticSlots(fp)) {
      this.pendingFp = null; this.pendingHits = 0;
      return { newHand: false, reason: 'semantic-change-without-transition', distance };
    }

    if (this.pendingFp && heroIdentityDistance(this.pendingFp, fp) < 0.065) this.pendingHits++;
    else { this.pendingFp = fp; this.pendingHits = 1; }
    if (this.pendingHits >= identityConfirmationHits(fp, false) && now - this.state.startedAt > 120) {
      this.lastFp = fp; this.pendingFp = null; this.pendingHits = 0; this.reappearArmed = false; this.newHand('hero-glyph-change', now);
      return { newHand: true, reason: 'hero-glyph-change', distance };
    }
    return { newHand: false, reason: null, distance };
  }
  observeBoardCount(count, now = performance.now()) {
    if (![0, 3, 4, 5].includes(count)) return { newHand: false, reason: null };
    if (count > 0) {
      this.lastBoardCountVisual = Math.max(this.lastBoardCountVisual, count);
      this.boardZeroHits = 0;
      this.boardZeroSince = 0;
      return { newHand: false, reason: null };
    }
    if (this.lastBoardCountVisual <= 0) return { newHand: false, reason: null };

    this.boardZeroHits++;
    if (!this.boardZeroSince) this.boardZeroSince = now;
    const boardGoneLongEnough = this.boardZeroHits >= 8 && now - this.boardZeroSince >= 700;
    const heroGoneLongEnough = this.heroMissing >= 8 && now - this.lastHeroSeenAt >= 320;
    if (!boardGoneLongEnough || !heroGoneLongEnough || now - this.state.startedAt <= 250) {
      return { newHand: false, reason: null };
    }

    this.newHand('board-reset', now); this.lastFp = null; this.pendingFp = null; this.pendingHits = 0; this.adoptNextHero = true;
    return { newHand: true, reason: 'board-reset' };
  }
  observePotValue(v, now = performance.now()) {
    if (!Number.isFinite(v) || v <= 1 || this.state.pot === null || this.state.board.length > 0) {
      this.potResetPending = null; this.potResetHits = 0; return { newHand: false, reason: null };
    }
    const n = Math.round(v), old = this.state.pot;
    const materialDrop = n <= old * 0.65 && old - n >= Math.max(100, old * 0.25);
    if (!materialDrop) { this.potResetPending = null; this.potResetHits = 0; return { newHand: false, reason: null }; }
    const close = this.potResetPending !== null && Math.abs(this.potResetPending - n) <= Math.max(2, n * 0.01);
    if (close) this.potResetHits++; else { this.potResetPending = n; this.potResetHits = 1; }
    if (this.potResetHits < 2 || now - this.state.startedAt <= 150) return { newHand: false, reason: null };
    this.newHand('pot-reset', now); this.adoptNextHero = true; this.potResetPending = null; this.potResetHits = 0;
    return { newHand: true, reason: 'pot-reset' };
  }
  maybeNewHand(fp) { return this.observeHero(fp, !!fp?.length).newHand; }
  setHero(cards, handId) {
    if (handId !== this.handId) return false;
    if (!Array.isArray(cards) || cards.length !== 2 || cards.some((c) => !c?.rank)) return false;
    const current = this.state.hero;
    if (Array.isArray(current) && current.length === 2 && current.every((c) => c?.rank)) {
      const sameRanks = cards.every((c, i) => String(c.rank).toUpperCase() === String(current[i].rank).toUpperCase());
      if (!sameRanks) return false;
      this.state.hero = mergeStickyHero(current, cards);
      return true;
    }
    this.state.hero = cards.map((c) => ({ ...c })); return true;
  }
  setBoardOccupancy(count, handId) {
    if (handId !== this.handId || ![0, 3, 4, 5].includes(count)) return false;
    if (count === 0) {
      if (!this.state.board.length) this.state.street = 'preflop';
      return true;
    }
    const currentCount = this.state.board.length;
    const stableCount = Math.max(currentCount, count);
    this.state.street = stableCount === 3 ? 'flop' : stableCount === 4 ? 'turn' : stableCount >= 5 ? 'river' : this.state.street;
    return true;
  }
  setBoard(cards, handId) {
    if (handId !== this.handId) return false;
    if (!Array.isArray(cards) || ![0, 3, 4, 5].includes(cards.length)) return false;
    if (cards.length === 0) {
      if (!this.state.board.length) this.state.street = 'preflop';
      return true;
    }
    const current = Array.isArray(this.state.board) ? this.state.board : [];
    if (current.length && cards.length < current.length) return false;
    this.state.board = current.length ? mergeStickyBoard(current, cards) : cards.map((c) => ({ ...c }));
    const count = this.state.board.length;
    this.state.street = count === 3 ? 'flop' : count === 4 ? 'turn' : count === 5 ? 'river' : this.state.street;
    return true;
  }
  setPot(v, handId) { if (handId !== this.handId || !Number.isFinite(v) || v <= 1) return false; this.state.pot = Math.round(v); return true; }
  setActions(actions, handId) {
    if (handId !== this.handId) return false;
    this.actionMisses = 0; this.state.actions = Array.isArray(actions) ? actions : []; this.state.heroToAct = this.state.actions.length >= 2; return true;
  }
  missActions(handId, maxMisses = 3) {
    if (handId !== this.handId || !this.state.heroToAct) return false;
    this.actionMisses++; if (this.actionMisses < maxMisses) return false;
    this.actionMisses = 0; this.state.actions = []; this.state.heroToAct = false; return true;
  }
}
