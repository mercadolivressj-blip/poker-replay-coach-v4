export class DealLifecycleR14 {
  constructor({ heroMissingHits = 4, heroMissingMs = 260, heroReappearHits = 2, boardZeroHits = 3, boardZeroMs = 120 } = {}) {
    this.heroMissingHitsNeeded = heroMissingHits;
    this.heroMissingMs = heroMissingMs;
    this.heroReappearHitsNeeded = heroReappearHits;
    this.boardZeroHitsNeeded = boardZeroHits;
    this.boardZeroMs = boardZeroMs;
    this.reset(0, 0);
  }

  reset(generation = 0, now = 0) {
    this.generation = Number(generation) || 0;
    this.seenHeroPresent = false;
    this.heroMissingSince = 0;
    this.heroMissingHits = 0;
    this.heroGapArmed = false;
    this.heroReappearHits = 0;
    this.maxVisualBoardCount = 0;
    this.visualBoardCount = 0;
    this.visualBoardHits = 0;
    this.visualBoardUpdatedAt = Number(now) || 0;
    this.boardZeroSince = 0;
    this.boardClearArmed = false;
    this.lastReason = 'reset';
  }

  seedHeroPresence(present, now = 0) {
    if (!present) return;
    this.seenHeroPresent = true;
    this.heroMissingSince = 0;
    this.heroMissingHits = 0;
    this.heroGapArmed = false;
    this.heroReappearHits = 0;
    this.lastReason = 'hero-present';
    if (now) this.lastHeroSeenAt = now;
  }

  observeHero(present, now = 0) {
    const t = Number(now) || 0;
    if (!present) {
      this.heroReappearHits = 0;
      if (!this.seenHeroPresent) {
        this.lastReason = 'hero-not-seen-yet';
        return { newDeal: false, reason: this.lastReason };
      }
      if (!this.heroMissingSince) this.heroMissingSince = t;
      this.heroMissingHits++;
      const elapsed = Math.max(0, t - this.heroMissingSince);
      if (this.heroMissingHits >= this.heroMissingHitsNeeded && elapsed >= this.heroMissingMs) {
        this.heroGapArmed = true;
        this.lastReason = 'hero-gap-armed';
      } else {
        this.lastReason = 'hero-gap-candidate';
      }
      return { newDeal: false, reason: this.lastReason, missingHits: this.heroMissingHits, elapsed };
    }

    this.lastHeroSeenAt = t;
    if (!this.seenHeroPresent) {
      this.seedHeroPresence(true, t);
      return { newDeal: false, reason: 'hero-first-presence' };
    }

    if (this.heroGapArmed) {
      this.heroReappearHits++;
      // A board that was previously visible and is now stably empty is strong
      // independent evidence that the old deal ended, so one physical Hero
      // reappearance is enough. Otherwise require two consecutive presences.
      const needed = this.boardClearArmed ? 1 : this.heroReappearHitsNeeded;
      if (this.heroReappearHits >= needed) {
        this.lastReason = this.boardClearArmed ? 'physical-redeal-board-cleared' : 'physical-hero-redeal';
        return { newDeal: true, reason: this.lastReason };
      }
      this.lastReason = 'hero-reappear-candidate';
      return { newDeal: false, reason: this.lastReason, reappearHits: this.heroReappearHits, needed };
    }

    this.heroMissingSince = 0;
    this.heroMissingHits = 0;
    this.heroReappearHits = 0;
    this.lastReason = 'hero-present';
    return { newDeal: false, reason: this.lastReason };
  }

  observeBoardCount(count, now = 0) {
    if (![0, 3, 4, 5].includes(count)) return this.view();
    const t = Number(now) || 0;
    if (count === this.visualBoardCount) this.visualBoardHits++;
    else {
      this.visualBoardCount = count;
      this.visualBoardHits = 1;
    }
    this.visualBoardUpdatedAt = t;

    if (count > 0) {
      this.maxVisualBoardCount = Math.max(this.maxVisualBoardCount, count);
      this.boardZeroSince = 0;
      this.boardClearArmed = false;
    } else if (this.maxVisualBoardCount > 0) {
      if (!this.boardZeroSince) this.boardZeroSince = t;
      const elapsed = Math.max(0, t - this.boardZeroSince);
      if (this.visualBoardHits >= this.boardZeroHitsNeeded && elapsed >= this.boardZeroMs) {
        this.boardClearArmed = true;
      }
    }
    return this.view();
  }

  view() {
    return {
      generation: this.generation,
      seenHeroPresent: this.seenHeroPresent,
      heroMissingHits: this.heroMissingHits,
      heroGapArmed: this.heroGapArmed,
      heroReappearHits: this.heroReappearHits,
      visualBoardCount: this.visualBoardCount,
      visualBoardHits: this.visualBoardHits,
      visualBoardUpdatedAt: this.visualBoardUpdatedAt,
      maxVisualBoardCount: this.maxVisualBoardCount,
      boardClearArmed: this.boardClearArmed,
      lastReason: this.lastReason,
    };
  }
}
