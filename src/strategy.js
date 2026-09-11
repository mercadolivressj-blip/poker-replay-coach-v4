const ranks = '23456789TJQKA';
const rv = (r) => ranks.indexOf(String(r || '').toUpperCase()) + 2;
const fmt = (n) => Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n);

function preflopScore(cards) {
  if (cards.length < 2) return null;
  const a = rv(cards[0].rank), b = rv(cards[1].rank);
  if (a < 2 || b < 2) return null;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  let s = ({ 14: 10, 13: 8, 12: 7, 11: 6 }[hi] ?? hi / 2);
  if (hi === lo) s = Math.max(5, s * 2);
  const suited = cards[0].suit && cards[0].suit === cards[1].suit;
  if (suited) s += 2;
  const gap = hi - lo - 1;
  if (hi !== lo) {
    if (gap === 1) s -= 1;
    else if (gap === 2) s -= 2;
    else if (gap === 3) s -= 4;
    else if (gap >= 4) s -= 5;
    if (gap <= 1 && hi < 12) s += 1;
  }
  return Math.round(s * 2) / 2;
}
function rankCounts(cards) { const m = new Map(); for (const c of cards) if (rv(c.rank) >= 2) m.set(c.rank, (m.get(c.rank) || 0) + 1); return m; }
function suitCounts(cards) { const m = new Map(); for (const c of cards) if (c.suit) m.set(c.suit, (m.get(c.suit) || 0) + 1); return m; }
function straightHighFromValues(values) {
  const vals = [...new Set(values.filter((v) => v >= 2))].sort((a, b) => a - b); if (vals.includes(14)) vals.unshift(1);
  let run = 1, high = 0;
  for (let i = 1; i < vals.length; i++) { if (vals[i] === vals[i - 1] + 1) run++; else run = 1; if (run >= 5) high = vals[i] === 1 ? 5 : vals[i]; }
  return high;
}
const hasStraight = (cards) => straightHighFromValues(cards.map((c) => rv(c.rank)));
export function analyzeMadeHand(hero, board) {
  const all = [...hero, ...board];
  const counts = [...rankCounts(all).entries()].sort((a, b) => b[1] - a[1] || rv(b[0]) - rv(a[0]));
  const suits = suitCounts(all);
  for (const [suit, n] of suits) if (n >= 5) { const sf = straightHighFromValues(all.filter((c) => c.suit === suit).map((c) => rv(c.rank))); if (sf) return { name: 'straight flush', tier: 9 }; }
  if (counts[0]?.[1] === 4) return { name: 'quadra', tier: 8 };
  const trips = counts.filter(([, n]) => n >= 3), pairs = counts.filter(([, n]) => n >= 2);
  if (trips.length && pairs.some(([r]) => r !== trips[0][0])) return { name: 'full house', tier: 7 };
  if ([...suits.values()].some((n) => n >= 5)) return { name: 'flush', tier: 6 };
  if (hasStraight(all)) return { name: 'sequência', tier: 5 };
  if (trips.length) return { name: 'trinca', tier: 4 };
  if (pairs.length >= 2) return { name: 'dois pares', tier: 3 };
  if (pairs.length === 1) {
    const pairRank = rv(pairs[0][0]), boardTop = Math.max(...board.map((c) => rv(c.rank)), 0), heroRanks = hero.map((c) => rv(c.rank));
    const pocketPair = heroRanks.length === 2 && heroRanks[0] === heroRanks[1];
    if (pocketPair && pairRank > boardTop) return { name: 'overpair', tier: 2.9 };
    const heroMade = hero.some((c) => c.rank === pairs[0][0]);
    if (heroMade && pairRank >= boardTop) return { name: 'top pair / par alto', tier: 2.6 };
    return { name: 'um par', tier: 2 };
  }
  return { name: 'carta alta', tier: 1 };
}
export function analyzeDraws(hero, board) {
  if (board.length >= 5) return { flushDraw: false, straightDraw: false, straightDrawType: null };
  const all = [...hero, ...board]; let flushDraw = false; const suits = suitCounts(all);
  for (const [suit, n] of suits) if (n === 4 && hero.some((c) => c.suit === suit)) flushDraw = true;
  const allVals = new Set(all.map((c) => rv(c.rank)).filter((v) => v >= 2)); if (allVals.has(14)) allVals.add(1);
  const heroVals = new Set(hero.map((c) => rv(c.rank)).flatMap((v) => (v === 14 ? [14, 1] : [v])));
  let straightDraw = false, open = false;
  for (let low = 1; low <= 10; low++) {
    const window = [low, low + 1, low + 2, low + 3, low + 4], present = window.filter((v) => allVals.has(v));
    if (present.length !== 4 || !present.some((v) => heroVals.has(v))) continue;
    straightDraw = true; const missing = window.find((v) => !allVals.has(v)); if (missing === low || missing === low + 4) open = true;
  }
  return { flushDraw, straightDraw, straightDrawType: straightDraw ? (open ? 'open-ended' : 'gutshot') : null };
}
export function boardTexture(board) {
  if (board.length < 3) return 'sem board';
  const counts = rankCounts(board), paired = [...counts.values()].some((n) => n >= 2), suits = suitCounts(board), suitMax = Math.max(0, ...suits.values());
  const vals = [...new Set(board.map((c) => rv(c.rank)).filter((v) => v >= 2))].sort((a, b) => a - b); if (vals.includes(14)) vals.unshift(1);
  let connected = false; for (let low = 1; low <= 10; low++) if ([low, low + 1, low + 2, low + 3, low + 4].filter((v) => vals.includes(v)).length >= 3) connected = true;
  const wet = suitMax >= 3 || connected; if (paired && wet) return 'pareado e conectado'; if (paired) return 'pareado'; if (wet) return 'conectado'; return 'seco';
}
const find = (actions, type) => actions.find((a) => a.type === type); const has = (actions, type) => !!find(actions, type);
const out = (decision, reason, confidence = 65, details = []) => ({ decision, reason, confidence, details });
export function recommend(state) {
  const missing = []; if (state.hero.length < 2) missing.push('cartas'); if (state.actions.length < 2) missing.push('ações'); if (state.street !== 'preflop' && state.board.length < 3) missing.push('board');
  if (missing.length) return { decision: null, reason: `Falta ${missing.join(', ')}.`, confidence: 0, details: [] };
  const actions = state.actions, call = find(actions, 'call')?.amount ?? null, facingBet = has(actions, 'call') && !has(actions, 'check'), pot = state.pot, potOdds = call && pot ? call / (pot + call) : null;
  if (state.street === 'preflop') {
    const s = preflopScore(state.hero); if (s === null) return { decision: null, reason: 'Força pré-flop ainda não confiável.', confidence: 0, details: [] };
    const pair = state.hero[0].rank === state.hero[1].rank, hi = Math.max(rv(state.hero[0].rank), rv(state.hero[1].rank));
    const details = [`Força pré-flop heurística: ${fmt(s)}/20.`, 'Sem posição/linha completa, confiança deliberadamente limitada.']; if (potOdds !== null) details.push(`Preço do call: ~${Math.round(potOdds * 100)}% do pote final.`);
    if ((s >= 9 || (pair && hi >= 10)) && has(actions, 'raise')) return out('AUMENTAR', 'Mão forte o bastante para tomar a iniciativa.', 78, details);
    if (s >= 7 && has(actions, 'call') && call === null) return { decision: null, reason: 'Lendo o valor do call…', confidence: 0, details };
    if (s >= 7 && has(actions, 'call')) return out('PAGAR', 'Mão jogável; continuar é razoável sem contexto posicional completo.', 66, details);
    if (has(actions, 'check')) return out('PASSAR', 'Sem custo adicional: veja o próximo street.', 72, details);
    if (has(actions, 'fold')) return out('DESISTIR', 'Mão fraca para investir sem vantagem contextual clara.', 72, details);
    return { decision: null, reason: 'Nenhuma ação compatível foi lida.', confidence: 0, details };
  }
  const made = analyzeMadeHand(state.hero, state.board), draws = analyzeDraws(state.hero, state.board), texture = boardTexture(state.board);
  const details = [`Mão: ${made.name}.`, `Board: ${texture}.`]; if (draws.flushDraw) details.push('Flush draw confirmado pelos naipes do Hero + mesa.'); if (draws.straightDraw) details.push(`Straight draw ${draws.straightDrawType}.`); if (potOdds !== null) details.push(`Pot odds do call: ~${Math.round(potOdds * 100)}%.`);
  if (facingBet && made.tier < 4 && (call === null || pot === null)) return { decision: null, reason: call === null ? 'Lendo o valor do call…' : 'Lendo o pote…', confidence: 0, details };
  if (!facingBet) {
    if (made.tier >= 4 && has(actions, 'bet')) return out('APOSTAR', 'Mão forte: extrair valor é prioridade.', 82, details);
    if (made.tier >= 2.5 && has(actions, 'bet')) return out('APOSTAR', 'Valor/proteção com mão feita razoável.', 72, details);
    if ((draws.flushDraw || draws.straightDraw) && has(actions, 'bet')) return out('APOSTAR', 'Semi-blefe possível com equity de draw.', 61, details);
    if (has(actions, 'check')) return out('PASSAR', 'Controle de pote é a linha mais segura com esta leitura.', 70, details);
  } else {
    if (made.tier >= 4 && has(actions, 'raise')) return out('AUMENTAR', 'Mão muito forte contra aposta: construir valor.', 82, details);
    if (made.tier >= 2.5 && has(actions, 'call')) return out('PAGAR', 'Mão feita suficiente para continuar.', 70, details);
    if ((draws.flushDraw || draws.straightDraw) && has(actions, 'call') && (potOdds === null || potOdds <= 0.3)) return out('PAGAR', 'Draw relevante com preço ainda aceitável.', 62, details);
    if (made.tier <= 2 && has(actions, 'fold')) return out('DESISTIR', 'Mão fraca contra pressão e sem base para hero-call.', 74, details);
  }
  if (has(actions, 'check')) return out('PASSAR', 'Sem linha agressiva clara com os dados atuais.', 64, details);
  if (has(actions, 'call')) return out('PAGAR', 'Continuação conservadora; faltam posição/linha completa para maior precisão.', 55, details);
  if (has(actions, 'fold')) return out('DESISTIR', 'Sem leitura suficiente para justificar continuar.', 60, details);
  return { decision: null, reason: 'Sem ação compatível.', confidence: 0, details };
}
