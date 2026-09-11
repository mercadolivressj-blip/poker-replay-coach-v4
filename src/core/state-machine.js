import { pairVectorDistance } from './image.js';

export let activeHandMachine = null;

function semanticSlots(v) {
  if (typeof v === 'string' && v.length === 2) return [v[0], v[1]];
  if (Array.isArray(v) && v.length === 2 && v.every((x) => x == null || typeof x === 'string'))
    return v;
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

export class HandMachine {
  constructor() { this.resetSession(); activeHandMachine = this; }
  resetSession() {
    this.handId = 0; this.lastFp = null; this.pendingFp = null; this.pendingHits = 0;
    this.heroMissing = 0; this.reappearArmed = false; this.adoptNextHero = false; this.lastHeroSeenAt = 0;
    this.lastBoardCountVisual = 0; this.boardZeroHits = 0; this.actionMisses = 0;
    this.potResetPending = null; this.potResetHits = 0; this.state = this.blank(0);
  }
  blank(now = performance.now()) {
    return { hero: [], board: [], street: 'preflop', pot: null, actions: [], heroToAct: false, confidence: 0, startedAt: now, reason: 'waiting', provisionalDecision: null };
  }
  newHand(reason, now = performance.now()) {
    this.handId++; this.state = this.blank(now); this.state.reason = reason; this.actionMisses = 0;
    this.boardZeroHits = 0; this.lastBoardCountVisual = 0; this.potResetPending = null; this.potResetHits = 0;
  }
  observeHero(fp, present, now = performance.now()) {
    if (!present) { this.heroMissing++; if (this.heroMissing >= 3) this.reappearArmed = true; return { newHand: false, reason: null }; }
    if (fp === null || fp === undefined || (Array.isArray(fp) && !fp.length) || fp === '') {
      this.heroMissing = 0; this.lastHeroSeenAt = now; return { newHand: false, reason: 'hero-identity-unknown' };
    }
    const wasMissing = this.heroMissing > 0; this.heroMissing = 0; this.lastHeroSeenAt = now;
    if (this.adoptNextHero) {
      this.lastFp = fp; this.pendingFp = null; this.pendingHits = 0; this.reappearArmed = false; this.adoptNextHero = false;
      return { newHand: false, reason: 'hero-adopted-after-board-reset', distance: null };
    }
    if (this.lastFp === null) {
      this.lastFp = fp; this.reappearArmed = false; this.newHand('first-cards', now); return { newHand: true, reason: 'first-cards' };
    }
    if (this.reappearArmed && now - this.state.startedAt > 120) {
      this.lastFp = fp; this.pendingFp = null; this.pendingHits = 0; this.reappearArmed = false; this.newHand('hero-reappeared', now);
      return { newHand: true, reason: 'hero-reappeared' };
    }
    const distance = heroIdentityDistance(this.lastFp, fp);
    if (distance < 0.13) { this.pendingFp = null; this.pendingHits = 0; if (wasMissing) this.reappearArmed = false; return { newHand: false, reason: null, distance }; }
    if (this.pendingFp && heroIdentityDistance(this.pendingFp, fp) < 0.065) this.pendingHits++;
    else { this.pendingFp = fp; this.pendingHits = 1; }
    if (this.pendingHits >= 2 && now - this.state.startedAt > 120) {
      this.lastFp = fp; this.pendingFp = null; this.pendingHits = 0; this.reappearArmed = false; this.newHand('hero-glyph-change', now);
      return { newHand: true, reason: 'hero-glyph-change', distance };
    }
    return { newHand: false, reason: null, distance };
  }
  observeBoardCount(count, now = performance.now()) {
    if (![0, 3, 4, 5].includes(count)) return { newHand: false, reason: null };
    if (count > 0) { this.lastBoardCountVisual = count; this.boardZeroHits = 0; return { newHand: false, reason: null }; }
    if (this.lastBoardCountVisual <= 0) return { newHand: false, reason: null };
    this.boardZeroHits++;
    if (this.boardZeroHits < 2 || now - this.state.startedAt <= 150) return { newHand: false, reason: null };
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
    this.state.hero = cards; return true;
  }
  setBoardOccupancy(count, handId) {
    if (handId !== this.handId || ![0, 3, 4, 5].includes(count)) return false;
    this.state.street = count === 0 ? 'preflop' : count === 3 ? 'flop' : count === 4 ? 'turn' : 'river';
    if (count === 0) this.state.board = [];
    if (count > 0 && this.state.board.length > count) this.state.board = this.state.board.slice(0, count);
    return true;
  }
  setBoard(cards, handId) {
    if (handId !== this.handId) return false;
    if (!Array.isArray(cards) || ![0, 3, 4, 5].includes(cards.length)) return false;
    this.state.board = cards;
    this.state.street = cards.length === 0 ? 'preflop' : cards.length === 3 ? 'flop' : cards.length === 4 ? 'turn' : 'river';
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
