const RANKS = '23456789TJQKA';
const rv = (rank) => RANKS.indexOf(String(rank || '').toUpperCase()) + 2;

function rankCounts(cards) {
  const out = new Map();
  for (const c of cards || []) if (rv(c?.rank) >= 2) out.set(c.rank, (out.get(c.rank) || 0) + 1);
  return out;
}

function suitCounts(cards) {
  const out = new Map();
  for (const c of cards || []) if (c?.suit) out.set(c.suit, (out.get(c.suit) || 0) + 1);
  return out;
}

function straightWindows(cards) {
  const values = new Set((cards || []).map((c) => rv(c?.rank)).filter((v) => v >= 2));
  if (values.has(14)) values.add(1);
  let three = 0;
  let four = 0;
  let made = 0;
  for (let low = 1; low <= 10; low++) {
    const n = [low, low + 1, low + 2, low + 3, low + 4].filter((v) => values.has(v)).length;
    if (n >= 3) three++;
    if (n >= 4) four++;
    if (n === 5) made++;
  }
  return { three, four, made };
}

function maxSuit(cards) {
  const counts = suitCounts(cards);
  let suit = null;
  let count = 0;
  for (const [s, n] of counts) if (n > count) { suit = s; count = n; }
  return { suit, count };
}

export function profileBoard(board = []) {
  const cards = Array.isArray(board) ? board.filter((c) => c?.rank) : [];
  const ranks = rankCounts(cards);
  const suits = suitCounts(cards);
  const straight = straightWindows(cards);
  const max = maxSuit(cards);
  const values = cards.map((c) => rv(c.rank)).filter((v) => v >= 2);
  const top = values.length ? Math.max(...values) : null;
  const paired = [...ranks.values()].some((n) => n >= 2);
  const tripsOnBoard = [...ranks.values()].some((n) => n >= 3);
  const monotone = cards.length >= 3 && max.count >= Math.min(3, cards.length);
  const fourFlushBoard = max.count >= 4;
  const threeFlushBoard = max.count === 3;
  const twoToneFlop = cards.length >= 3 && maxSuit(cards.slice(0, 3)).count === 2;
  const rainbowFlop = cards.length >= 3 && maxSuit(cards.slice(0, 3)).count === 1;
  const broadwayCount = values.filter((v) => v >= 10).length;
  const high = top >= 13 ? 'high' : top >= 10 ? 'medium' : 'low';

  const changes = {
    turn: null,
    river: null,
  };
  if (cards.length >= 4) changes.turn = streetChange(cards.slice(0, 3), cards.slice(0, 4));
  if (cards.length >= 5) changes.river = streetChange(cards.slice(0, 4), cards.slice(0, 5));

  return {
    count: cards.length,
    paired,
    tripsOnBoard,
    monotone,
    fourFlushBoard,
    threeFlushBoard,
    twoToneFlop,
    rainbowFlop,
    straightPressure: straight.four > 0 ? 'high' : straight.three > 0 ? 'medium' : 'low',
    straightMadeOnBoard: straight.made > 0,
    broadwayCount,
    high,
    dominantSuit: max.suit,
    dominantSuitCount: max.count,
    changes,
    tags: boardTags({ paired, tripsOnBoard, max, straight, broadwayCount, high }),
  };
}

function streetChange(before, after) {
  const card = after[after.length - 1];
  const beforeRanks = rankCounts(before);
  const beforeSuit = maxSuit(before);
  const afterSuit = maxSuit(after);
  const beforeStraight = straightWindows(before);
  const afterStraight = straightWindows(after);
  const topBefore = Math.max(...before.map((c) => rv(c.rank)), 0);
  const cardValue = rv(card?.rank);
  const pairedBoard = (beforeRanks.get(card?.rank) || 0) > 0;
  const flushPressureUp = afterSuit.count > beforeSuit.count && afterSuit.count >= 3;
  const straightPressureUp = afterStraight.four > beforeStraight.four || afterStraight.made > beforeStraight.made;
  const overcard = cardValue > topBefore && cardValue >= 10;
  const highOvercard = cardValue > topBefore && cardValue >= 13;
  const brick = !pairedBoard && !flushPressureUp && !straightPressureUp && !overcard;
  return {
    rank: card?.rank || null,
    suit: card?.suit || null,
    pairedBoard,
    flushPressureUp,
    straightPressureUp,
    overcard,
    highOvercard,
    brick,
  };
}

function boardTags({ paired, tripsOnBoard, max, straight, broadwayCount, high }) {
  const tags = [];
  if (tripsOnBoard) tags.push('board-trips');
  else if (paired) tags.push('paired');
  if (max.count >= 4) tags.push('four-flush');
  else if (max.count === 3) tags.push('three-flush');
  else if (max.count === 2) tags.push('two-tone');
  if (straight.made) tags.push('straight-on-board');
  else if (straight.four) tags.push('four-to-straight');
  else if (straight.three) tags.push('connected');
  if (broadwayCount >= 3) tags.push('broadway-heavy');
  tags.push(`${high}-board`);
  return tags;
}

export function heroBlockers(hero = [], board = []) {
  const h = Array.isArray(hero) ? hero.filter((c) => c?.rank) : [];
  const profile = profileBoard(board);
  const features = [];
  let valueBlock = 0;
  let bluffBlock = 0;

  if (profile.dominantSuit && profile.dominantSuitCount >= 3) {
    const suitedHero = h.filter((c) => c.suit === profile.dominantSuit);
    if (suitedHero.some((c) => c.rank === 'A')) {
      valueBlock += 18;
      features.push('bloqueia nut flush');
    } else if (suitedHero.some((c) => ['K', 'Q'].includes(c.rank))) {
      valueBlock += 9;
      features.push('bloqueia flushes altos');
    }
  }

  const boardRanks = rankCounts(board);
  for (const c of h) {
    const n = boardRanks.get(c.rank) || 0;
    if (n >= 1) {
      valueBlock += n >= 2 ? 12 : 6;
      features.push(`bloqueia valor com ${c.rank}`);
    }
  }

  const river = profile.changes.river;
  if (river?.brick) {
    const flop = board.slice(0, 3);
    const flopSuit = maxSuit(flop);
    if (flopSuit.count === 2 && h.some((c) => c.suit === flopSuit.suit)) {
      bluffBlock += 8;
      features.push('bloqueia parte dos draws de flush que erraram');
    }
  }

  return {
    valueBlock: Math.min(35, valueBlock),
    bluffBlock: Math.min(25, bluffBlock),
    features: [...new Set(features)],
  };
}
