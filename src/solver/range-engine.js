import { fullDeck, cardId, evaluateBest, rankValue } from './hand-evaluator.js';

const POSITION_LOOSENESS = {
  'UTG': 0.30, 'UTG+1': 0.34, 'UTG+2': 0.38, 'MP': 0.43, 'LJ': 0.48,
  'HJ': 0.54, 'CO': 0.64, 'BTN': 0.76, 'BTN/SB': 0.68, 'SB': 0.58, 'BB': 0.70,
};

function clamp(n, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, n)); }
function streetBoard(board, street) {
  const n = street === 'flop' ? 3 : street === 'turn' ? 4 : street === 'river' ? 5 : 0;
  return (board || []).slice(0, n);
}

function holeQuality(cards) {
  if (!cards || cards.length !== 2) return 0;
  const a = rankValue(cards[0].rank), b = rankValue(cards[1].rank);
  const hi = Math.max(a, b), lo = Math.min(a, b);
  const pair = a === b;
  const suited = cards[0].suit && cards[0].suit === cards[1].suit;
  const gap = Math.abs(a - b);
  let q = (hi - 2) / 12 * 0.46 + (lo - 2) / 12 * 0.22;
  if (pair) q += 0.26 + (hi - 2) / 12 * 0.18;
  if (suited) q += 0.07;
  if (gap === 1) q += 0.08;
  else if (gap === 2) q += 0.045;
  if (hi >= 11 && lo >= 10) q += 0.07;
  return clamp(q);
}

function comboMeta(cards) {
  const a = rankValue(cards[0].rank), b = rankValue(cards[1].rank);
  return {
    quality: holeQuality(cards),
    pair: a === b,
    suited: cards[0].suit === cards[1].suit,
    connected: Math.abs(a - b) <= 2,
  };
}

function initialWeight(cards, position = null) {
  const m = comboMeta(cards);
  const loose = POSITION_LOOSENESS[position] ?? 0.52;
  const exponent = 2.35 - loose * 1.35;
  const speculative = (m.suited ? 0.045 : 0) + (m.connected ? 0.04 : 0);
  return 0.012 + Math.pow(m.quality, exponent) + speculative * loose;
}

function drawSignals(cards, board) {
  const all = [...cards, ...(board || [])];
  const suits = new Map();
  for (const c of all) if (c.suit) suits.set(c.suit, (suits.get(c.suit) || 0) + 1);
  const flushDraw = (board?.length || 0) < 5 && [...suits.values()].some((n) => n === 4);
  const ranks = new Set(all.map((c) => rankValue(c.rank)).filter(Boolean));
  if (ranks.has(14)) ranks.add(1);
  let straightDraw = false;
  for (let high = 5; high <= 14; high++) {
    let have = 0;
    for (let r = high - 4; r <= high; r++) if (ranks.has(r)) have++;
    if (have >= 4 && (board?.length || 0) < 5) { straightDraw = true; break; }
  }
  return { flushDraw, straightDraw, draw: flushDraw || straightDraw };
}

function postflopSignals(cards, board) {
  const score = board.length >= 3 ? evaluateBest([...cards, ...board]) : -1;
  const category = score >= 0 ? Math.floor(score / Math.pow(15, 5)) : 0;
  const draws = drawSignals(cards, board);
  const strong = category >= 2;
  const medium = category === 1;
  const air = category === 0 && !draws.draw;
  return { category, strong, medium, air, ...draws };
}

function preflopLikelihood(cards, action) {
  const m = comboMeta(cards);
  const q = m.quality;
  const bluffability = (m.suited ? 0.6 : 0) + (m.connected ? 0.4 : 0);
  if (action === 'raise') return 0.35 + q * 1.75 + (1 - q) * bluffability * 0.28;
  if (action === 'allin') return 0.12 + Math.pow(q, 2.1) * 2.5;
  if (action === 'call') return 0.32 + (1 - Math.abs(q - 0.56)) * 0.92 + bluffability * 0.12;
  if (action === 'check') return 1;
  if (action === 'fold') return 0.02;
  return 1;
}

function postflopLikelihood(cards, board, action) {
  const s = postflopSignals(cards, board);
  if (action === 'check') return s.strong ? 0.76 : s.draw ? 1.08 : s.medium ? 1.06 : 1.14;
  if (action === 'call') return s.strong ? 1.08 : s.draw ? 1.46 : s.medium ? 1.32 : 0.42;
  if (action === 'bet') return s.strong ? 1.62 : s.draw ? 1.38 : s.medium ? 0.98 : 0.72;
  if (action === 'raise') return s.strong ? 2.18 : s.draw ? 1.52 : s.medium ? 0.62 : 0.34;
  if (action === 'allin') return s.strong ? 2.55 : s.draw ? 1.30 : s.medium ? 0.48 : 0.24;
  if (action === 'fold') return 0.02;
  return 1;
}

function actorSeat(table, actorName) {
  if (!actorName || !table?.seats) return null;
  const key = actorName.trim().toLowerCase();
  return table.seats.find((s) => String(s.actorName || '').trim().toLowerCase() === key) || null;
}

function normalizeAndTrim(range, maxCombos = 320) {
  const clean = range.filter((x) => Number.isFinite(x.weight) && x.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, maxCombos);
  const total = clean.reduce((s, x) => s + x.weight, 0) || 1;
  for (const x of clean) x.weight /= total;
  return clean;
}

export function buildOpponentRange({ hero = [], board = [], events = [], actorName = null, table = null, maxCombos = 320 } = {}) {
  const blocked = new Set([...hero, ...board].map(cardId));
  const deck = fullDeck().filter((c) => !blocked.has(cardId(c)));
  const seat = actorSeat(table, actorName);
  const position = seat?.position || null;
  const range = [];

  for (let i = 0; i < deck.length - 1; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      const cards = [deck[i], deck[j]];
      range.push({ cards, weight: initialWeight(cards, position), meta: comboMeta(cards) });
    }
  }

  let working = normalizeAndTrim(range, Math.max(maxCombos * 2, 520));
  const actorKey = String(actorName || '').trim().toLowerCase();
  const relevant = (events || []).filter((e) => !actorKey || String(e.actorName || '').trim().toLowerCase() === actorKey);
  for (const e of relevant) {
    const b = streetBoard(board, e.street);
    for (const combo of working) {
      const like = e.street === 'preflop' ? preflopLikelihood(combo.cards, e.action) : postflopLikelihood(combo.cards, b, e.action);
      const evidence = clamp(Number(e.confidence) || 0.65, 0.35, 1);
      combo.weight *= Math.pow(Math.max(0.015, like), evidence);
    }
    working = normalizeAndTrim(working, Math.max(maxCombos * 2, 520));
  }

  const out = normalizeAndTrim(working, maxCombos);
  let strong = 0, draw = 0, air = 0;
  const currentBoard = streetBoard(board, board.length >= 5 ? 'river' : board.length === 4 ? 'turn' : board.length >= 3 ? 'flop' : 'preflop');
  if (currentBoard.length >= 3) {
    for (const combo of out) {
      const s = postflopSignals(combo.cards, currentBoard);
      combo.signals = s;
      if (s.strong) strong += combo.weight;
      if (s.draw) draw += combo.weight;
      if (s.air) air += combo.weight;
    }
  }

  return {
    actorName,
    position,
    combos: out,
    summary: { strongShare: strong, drawShare: draw, airShare: air, comboCount: out.length },
  };
}

export { holeQuality, postflopSignals, initialWeight };
