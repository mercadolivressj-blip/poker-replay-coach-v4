import { fullDeck, cardId, compareHoldem, evaluateBest } from './hand-evaluator.js';

function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0 || 1;
}
function rngFrom(text) {
  let x = hashSeed(text);
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
function buildCdf(combos) {
  let sum = 0;
  const cdf = combos.map((c) => { sum += c.weight || 0; return sum; });
  if (sum <= 0) return { cdf: [], sum: 0 };
  return { cdf, sum };
}
function pickWeighted(combos, cdf, sum, r) {
  const target = r * sum;
  let lo = 0, hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] >= target) hi = mid; else lo = mid + 1;
  }
  return combos[lo];
}
function sampleRunout(deck, missing, random) {
  if (missing <= 0) return [];
  const pool = deck.slice();
  const out = [];
  for (let i = 0; i < missing; i++) {
    const idx = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[idx]] = [pool[idx], pool[i]];
    out.push(pool[i]);
  }
  return out;
}

export function estimateEquity({ hero = [], board = [], range, budget = 700, seed = '' } = {}) {
  const t0 = now();
  const combos = range?.combos || [];
  if (hero.length !== 2 || board.length > 5 || !combos.length) {
    return { equity: null, wins: 0, ties: 0, losses: 0, comparisons: 0, stderr: null, ms: now() - t0 };
  }

  let wins = 0, ties = 0, losses = 0, comparisons = 0;
  const known = new Set([...hero, ...board].map(cardId));
  const baseDeck = fullDeck().filter((c) => !known.has(cardId(c)));
  const missing = 5 - board.length;

  if (missing === 0) {
    for (const combo of combos) {
      if (comparisons >= Math.max(80, budget)) break;
      const result = compareHoldem(hero, combo.cards, board);
      const w = combo.weight || 0;
      if (result > 0) wins += w;
      else if (result === 0) ties += w;
      else losses += w;
      comparisons++;
    }
    const total = wins + ties + losses || 1;
    const equity = (wins + ties * 0.5) / total;
    return { equity, wins, ties, losses, comparisons, stderr: 0, exactRiver: comparisons === combos.length, ms: now() - t0 };
  }

  const { cdf, sum } = buildCdf(combos);
  if (!cdf.length) return { equity: null, wins: 0, ties: 0, losses: 0, comparisons: 0, stderr: null, ms: now() - t0 };
  const random = rngFrom(`${seed}|${hero.map(cardId)}|${board.map(cardId)}|${combos.length}`);
  const n = Math.max(80, Math.min(2200, Math.floor(budget)));

  for (let i = 0; i < n; i++) {
    const combo = pickWeighted(combos, cdf, sum, random());
    if (!combo) continue;
    const villainIds = new Set(combo.cards.map(cardId));
    if (combo.cards.some((c) => known.has(cardId(c)))) continue;
    const deck = baseDeck.filter((c) => !villainIds.has(cardId(c)));
    if (deck.length < missing) continue;
    const runout = sampleRunout(deck, missing, random);
    const result = compareHoldem(hero, combo.cards, [...board, ...runout]);
    if (result > 0) wins++;
    else if (result === 0) ties++;
    else losses++;
    comparisons++;
  }

  const total = comparisons || 1;
  const equity = (wins + ties * 0.5) / total;
  const stderr = Math.sqrt(Math.max(0, equity * (1 - equity)) / total);
  return { equity, wins, ties, losses, comparisons, stderr, exactRiver: false, ms: now() - t0 };
}

function nonCollidingCombo(sampler, used, random) {
  const { combos, cdf, sum } = sampler;
  for (let tries = 0; tries < 14; tries++) {
    const combo = pickWeighted(combos, cdf, sum, random());
    if (combo && combo.cards?.length === 2 && combo.cards.every((c) => !used.has(cardId(c)))) return combo;
  }
  return combos.find((combo) => combo.cards?.length === 2 && combo.cards.every((c) => !used.has(cardId(c)))) || null;
}

/**
 * Blocker-aware multiway equity. Every opponent is sampled from its own weighted
 * range, and previously selected hole cards are removed before the next range is
 * sampled. Ties divide the pot by the number of players sharing the best score.
 */
export function estimateMultiwayEquity({ hero = [], board = [], ranges = [], budget = 1100, seed = '' } = {}) {
  const t0 = now();
  const activeRanges = (ranges || []).filter((range) => Array.isArray(range?.combos) && range.combos.length);
  if (hero.length !== 2 || board.length > 5 || !activeRanges.length) {
    return { equity: null, wins: 0, ties: 0, losses: 0, comparisons: 0, stderr: null, opponents: 0, multiway: false, ms: now() - t0 };
  }
  if (activeRanges.length === 1) {
    return { ...estimateEquity({ hero, board, range: activeRanges[0], budget, seed }), opponents: 1, multiway: false };
  }

  const known = new Set([...hero, ...board].map(cardId));
  const samplers = activeRanges.map((range) => {
    const combos = (range.combos || []).filter((combo) => combo.cards?.length === 2 && combo.cards.every((c) => !known.has(cardId(c))));
    const { cdf, sum } = buildCdf(combos);
    return { combos, cdf, sum, actorName: range.actorName || null };
  });
  if (samplers.some((s) => !s.cdf.length)) {
    return { equity: null, wins: 0, ties: 0, losses: 0, comparisons: 0, stderr: null, opponents: activeRanges.length, multiway: true, ms: now() - t0 };
  }

  const baseDeck = fullDeck().filter((c) => !known.has(cardId(c)));
  const missing = 5 - board.length;
  const random = rngFrom(`${seed}|multiway|${hero.map(cardId)}|${board.map(cardId)}|${activeRanges.map((r) => r.actorName || r.combos.length).join('|')}`);
  const n = Math.max(120, Math.min(2600, Math.floor(budget)));
  let wins = 0, ties = 0, losses = 0, comparisons = 0, equitySum = 0;

  for (let i = 0; i < n; i++) {
    const used = new Set(known);
    const villains = [];
    let valid = true;
    for (const sampler of samplers) {
      const combo = nonCollidingCombo(sampler, used, random);
      if (!combo) { valid = false; break; }
      villains.push(combo.cards);
      for (const card of combo.cards) used.add(cardId(card));
    }
    if (!valid) continue;

    const deck = baseDeck.filter((c) => !used.has(cardId(c)));
    if (deck.length < missing) continue;
    const runout = sampleRunout(deck, missing, random);
    const finalBoard = [...board, ...runout];
    const heroScore = evaluateBest([...hero, ...finalBoard]);
    const villainScores = villains.map((cards) => evaluateBest([...cards, ...finalBoard]));
    const best = Math.max(heroScore, ...villainScores);
    if (heroScore < best) {
      losses++;
      comparisons++;
      continue;
    }

    const tiedVillains = villainScores.filter((score) => score === heroScore).length;
    if (tiedVillains) {
      ties++;
      equitySum += 1 / (tiedVillains + 1);
    } else {
      wins++;
      equitySum += 1;
    }
    comparisons++;
  }

  const total = comparisons || 1;
  const equity = equitySum / total;
  const stderr = Math.sqrt(Math.max(0, equity * (1 - equity)) / total);
  return {
    equity,
    wins,
    ties,
    losses,
    comparisons,
    stderr,
    exactRiver: false,
    opponents: activeRanges.length,
    multiway: true,
    ms: now() - t0,
  };
}
