const RANKS = '23456789TJQKA';
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const RV = Object.fromEntries([...RANKS].map((r, i) => [r, i + 2]));

export function cardId(c) { return c ? `${String(c.rank).toUpperCase()}${String(c.suit || '?')[0]}` : '?'; }
export function sameCard(a, b) { return !!a && !!b && String(a.rank).toUpperCase() === String(b.rank).toUpperCase() && a.suit === b.suit; }
export function fullDeck() {
  const out = [];
  for (const rank of RANKS) for (const suit of SUITS) out.push({ rank, suit });
  return out;
}

function encode(category, kickers = []) {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 15 + (kickers[i] || 0);
  return score;
}

function straightHigh(uniqueDesc) {
  const u = [...new Set(uniqueDesc)].sort((a, b) => b - a);
  if (u.includes(14)) u.push(1);
  for (let i = 0; i <= u.length - 5; i++) {
    let ok = true;
    for (let j = 1; j < 5; j++) if (u[i + j] !== u[i] - j) { ok = false; break; }
    if (ok) return u[i] === 1 ? 5 : u[i];
  }
  return 0;
}

export function evaluateFive(cards) {
  if (!Array.isArray(cards) || cards.length !== 5) return -1;
  const ranks = cards.map((c) => RV[String(c.rank).toUpperCase()] || 0).sort((a, b) => b - a);
  if (ranks.some((r) => !r)) return -1;
  const flush = cards.every((c) => c.suit && c.suit === cards[0].suit);
  const sHigh = straightHigh(ranks);
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (flush && sHigh) return encode(8, [sHigh]);
  if (groups[0][1] === 4) return encode(7, [groups[0][0], groups[1][0]]);
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) return encode(6, [groups[0][0], groups[1][0]]);
  if (flush) return encode(5, ranks);
  if (sHigh) return encode(4, [sHigh]);
  if (groups[0][1] === 3) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]).sort((a, b) => b - a);
    return encode(3, [groups[0][0], ...kickers]);
  }
  const pairs = groups.filter((g) => g[1] === 2).map((g) => g[0]).sort((a, b) => b - a);
  if (pairs.length >= 2) {
    const kicker = groups.filter((g) => g[1] === 1).map((g) => g[0]).sort((a, b) => b - a)[0] || 0;
    return encode(2, [pairs[0], pairs[1], kicker]);
  }
  if (pairs.length === 1) {
    const kickers = groups.filter((g) => g[1] === 1).map((g) => g[0]).sort((a, b) => b - a);
    return encode(1, [pairs[0], ...kickers]);
  }
  return encode(0, ranks);
}

export function evaluateBest(cards) {
  if (!Array.isArray(cards) || cards.length < 5 || cards.length > 7) return -1;
  if (cards.length === 5) return evaluateFive(cards);
  let best = -1;
  const n = cards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const s = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (s > best) best = s;
          }
  return best;
}

export function compareHoldem(hero, villain, board) {
  const hs = evaluateBest([...(hero || []), ...(board || [])]);
  const vs = evaluateBest([...(villain || []), ...(board || [])]);
  return hs === vs ? 0 : hs > vs ? 1 : -1;
}

export function rankValue(rank) { return RV[String(rank || '').toUpperCase()] || 0; }
