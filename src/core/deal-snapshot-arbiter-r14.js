const SUITS = new Set(['clubs', 'diamonds', 'hearts', 'spades']);

const cloneCards = (cards) => (cards || []).map((card) => ({ ...card }));
const rankOf = (card) => card?.rank ? String(card.rank).toUpperCase() : null;
const validCards = (cards, counts) => Array.isArray(cards) && counts.includes(cards.length) && cards.every((card) => rankOf(card));
const sameRanks = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((card, i) => rankOf(card) === rankOf(b[i]));
const streetForBoard = (cards) => cards.length === 3 ? 'flop' : cards.length === 4 ? 'turn' : cards.length === 5 ? 'river' : 'preflop';
const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

function mergeLockedCards(current, incoming) {
  return current.map((old, i) => {
    const next = incoming[i] || {};
    const oldSuit = SUITS.has(old?.suit) ? old.suit : null;
    const nextSuit = SUITS.has(next?.suit) ? next.suit : null;
    const suitConflict = oldSuit && nextSuit && oldSuit !== nextSuit;
    return {
      ...old,
      ...next,
      rank: old.rank,
      suit: suitConflict ? oldSuit : (oldSuit || nextSuit || null),
      confidence: Math.max(Number(old?.confidence) || 0, Number(next?.confidence) || 0),
      suitConfidence: suitConflict
        ? Number(old?.suitConfidence) || 0
        : Math.max(Number(old?.suitConfidence) || 0, Number(next?.suitConfidence) || 0),
      source: old?.source || next?.source || null,
    };
  });
}

function normalizePot(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

function potTolerance(value) {
  const n = Math.abs(Number(value) || 0);
  return Math.max(0.001, n * 0.02);
}

export class DealSnapshotArbiter {
  constructor(machine, { manualWindowMs = 3500 } = {}) {
    this.machine = machine;
    this.manualWindowMs = manualWindowMs;
    this.generation = -1;
    this.snapshot = null;
    this.manualSeq = 0;
    this.manual = null;
    this.diagnostics = {
      generationChanges: 0,
      heroLocks: 0,
      boardLocks: 0,
      potRegressionBlocks: 0,
      restores: 0,
      manualRequests: 0,
      manualRebinds: 0,
    };
    this.syncGeneration();
  }

  blankSnapshot(generation, now = nowMs()) {
    return {
      generation,
      hero: [],
      board: [],
      pot: null,
      street: 'preflop',
      committedAt: now,
    };
  }

  syncGeneration(now = nowMs()) {
    const generation = Number(this.machine?.handId) || 0;
    if (generation === this.generation && this.snapshot) return false;
    this.generation = generation;
    this.snapshot = this.blankSnapshot(generation, now);
    this.manual = null;
    this.diagnostics.generationChanges++;
    return true;
  }

  beginManualRecalibration(now = nowMs()) {
    this.syncGeneration(now);
    const token = { id: ++this.manualSeq, generation: this.generation };
    this.manual = {
      ...token,
      expiresAt: now + this.manualWindowMs,
      used: new Set(),
    };
    this.diagnostics.manualRequests++;
    return token;
  }

  canManualRebind(token, kind, now = nowMs()) {
    if (!token || !this.manual) return false;
    if (token.id !== this.manual.id || token.generation !== this.manual.generation) return false;
    if (this.generation !== token.generation || now > this.manual.expiresAt) return false;
    return !this.manual.used.has(kind);
  }

  consumeManualRebind(token, kind, now = nowMs()) {
    if (!this.canManualRebind(token, kind, now)) return false;
    this.manual.used.add(kind);
    this.diagnostics.manualRebinds++;
    return true;
  }

  commitHero(cards, { generation = this.machine?.handId, rebindToken = null, forceRebind = false, now = nowMs() } = {}) {
    this.syncGeneration(now);
    if (generation !== this.generation || !validCards(cards, [2])) return { accepted: false, reason: 'invalid-or-stale' };
    const incoming = cloneCards(cards);
    const current = this.snapshot.hero;
    let next = incoming;
    let rebound = false;

    if (validCards(current, [2])) {
      if (forceRebind) {
        if (!this.consumeManualRebind(rebindToken, 'hero', now)) {
          this.diagnostics.heroLocks++;
          return { accepted: false, reason: 'hero-generation-lock' };
        }
        rebound = true;
        next = incoming;
      } else if (!sameRanks(current, incoming)) {
        if (!this.consumeManualRebind(rebindToken, 'hero', now)) {
          this.diagnostics.heroLocks++;
          return { accepted: false, reason: 'hero-generation-lock' };
        }
        rebound = true;
      } else {
        next = mergeLockedCards(current, incoming);
      }
    }

    this.snapshot.hero = cloneCards(next);
    this.snapshot.committedAt = now;
    this.machine.state.hero = cloneCards(next);
    return { accepted: true, rebound, cards: cloneCards(next) };
  }

  commitBoard(cards, { generation = this.machine?.handId, rebindToken = null, forceRebind = false, now = nowMs() } = {}) {
    this.syncGeneration(now);
    if (generation !== this.generation || !Array.isArray(cards) || ![0, 3, 4, 5].includes(cards.length)) return { accepted: false, reason: 'invalid-or-stale' };
    if (cards.length && !validCards(cards, [3, 4, 5])) return { accepted: false, reason: 'invalid-or-stale' };

    const incoming = cloneCards(cards);
    const current = this.snapshot.board;
    let next = incoming;
    let rebound = false;

    if (current.length) {
      const prefix = incoming.slice(0, Math.min(current.length, incoming.length));
      const currentPrefix = current.slice(0, prefix.length);
      const rankConflict = !sameRanks(currentPrefix, prefix);
      const shrink = incoming.length < current.length;
      if (forceRebind || rankConflict || shrink || incoming.length === 0) {
        if (!this.consumeManualRebind(rebindToken, 'board', now)) {
          this.diagnostics.boardLocks++;
          return { accepted: false, reason: 'board-generation-lock' };
        }
        rebound = true;
        next = incoming;
      } else {
        next = [
          ...mergeLockedCards(current, incoming.slice(0, current.length)),
          ...incoming.slice(current.length),
        ];
      }
    } else if (incoming.length === 0) {
      next = [];
      if (this.canManualRebind(rebindToken, 'board', now)) this.consumeManualRebind(rebindToken, 'board', now);
    }

    this.snapshot.board = cloneCards(next);
    this.snapshot.street = streetForBoard(next);
    this.snapshot.committedAt = now;
    this.machine.state.board = cloneCards(next);
    this.machine.state.street = this.snapshot.street;
    return { accepted: true, rebound, cards: cloneCards(next) };
  }

  commitPot(value, { generation = this.machine?.handId, source = 'unknown', now = nowMs() } = {}) {
    this.syncGeneration(now);
    const pot = normalizePot(value);
    if (generation !== this.generation || pot === null) return { accepted: false, reason: 'invalid-or-stale' };

    const current = normalizePot(this.snapshot.pot);
    const manual = String(source) === 'manual';
    if (!manual && current !== null && pot < current - potTolerance(current)) {
      this.diagnostics.potRegressionBlocks++;
      return { accepted: false, reason: 'pot-regression-lock', current, incoming: pot };
    }

    this.snapshot.pot = pot;
    this.snapshot.committedAt = now;
    this.machine.state.pot = pot;
    return { accepted: true, pot };
  }

  restore(now = nowMs()) {
    this.syncGeneration(now);
    const state = this.machine?.state;
    if (!state) return false;
    let changed = false;

    if (validCards(this.snapshot.hero, [2]) && !sameRanks(state.hero, this.snapshot.hero)) {
      state.hero = cloneCards(this.snapshot.hero);
      changed = true;
    }

    if (this.snapshot.board.length && !sameRanks(state.board, this.snapshot.board)) {
      state.board = cloneCards(this.snapshot.board);
      state.street = this.snapshot.street;
      changed = true;
    }

    if (this.snapshot.pot !== null && (!Number.isFinite(state.pot) || state.pot <= 0)) {
      state.pot = this.snapshot.pot;
      changed = true;
    }

    if (changed) this.diagnostics.restores++;
    return changed;
  }

  view() {
    this.syncGeneration();
    return {
      ...this.snapshot,
      hero: cloneCards(this.snapshot.hero),
      board: cloneCards(this.snapshot.board),
    };
  }
}
