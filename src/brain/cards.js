const RANKS = '23456789TJQKA';
export const rankValue = (r) => RANKS.indexOf(String(r || '').toUpperCase()) + 2;

export function parseCard(code) {
  const s = String(code || '').trim();
  if (!/^[2-9TJQKA][hdcs]$/.test(s)) return null;
  return { code: s, rank: s[0], suit: s[1], value: rankValue(s[0]) };
}

export const parseCards = (codes) => (Array.isArray(codes) ? codes.map(parseCard).filter(Boolean) : []);

function straightHigh(values) {
  const set = new Set(values);
  if (set.has(14)) set.add(1);
  const v = [...set].sort((a, b) => a - b);
  let run = 1;
  let best = 0;
  for (let i = 1; i < v.length; i++) {
    if (v[i] === v[i - 1] + 1) run += 1;
    else run = 1;
    if (run >= 5) best = Math.max(best, v[i] === 1 ? 5 : v[i]);
  }
  return best;
}

function score5(cards) {
  const values = cards.map((c) => c.value).sort((a, b) => b - a);
  const counts = new Map();
  const suits = new Map();
  for (const c of cards) {
    counts.set(c.value, (counts.get(c.value) || 0) + 1);
    suits.set(c.suit, (suits.get(c.suit) || 0) + 1);
  }
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = [...suits.values()].some((n) => n === 5);
  const sh = straightHigh(values);
  let tier = 0;
  let name = 'carta alta';
  let tie = values;
  if (flush && sh) { tier = 8; name = 'straight flush'; tie = [sh]; }
  else if (groups[0]?.[1] === 4) { tier = 7; name = 'quadra'; tie = [groups[0][0], groups[1][0]]; }
  else if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) { tier = 6; name = 'full house'; tie = [groups[0][0], groups[1][0]]; }
  else if (flush) { tier = 5; name = 'flush'; tie = values; }
  else if (sh) { tier = 4; name = 'sequência'; tie = [sh]; }
  else if (groups[0]?.[1] === 3) { tier = 3; name = 'trinca'; tie = [groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a,b)=>b-a)]; }
  else if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) { tier = 2; name = 'dois pares'; tie = [Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]]; }
  else if (groups[0]?.[1] === 2) { tier = 1; name = 'um par'; tie = [groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a,b)=>b-a)]; }
  return { tier, name, tie };
}

const compareScore = (a, b) => {
  if (a.tier !== b.tier) return a.tier - b.tier;
  for (let i = 0; i < Math.max(a.tie.length, b.tie.length); i++) {
    const d = (a.tie[i] || 0) - (b.tie[i] || 0);
    if (d) return d;
  }
  return 0;
};

function choose5(cards, start = 0, picked = [], out = []) {
  if (picked.length === 5) { out.push([...picked]); return out; }
  for (let i = start; i <= cards.length - (5 - picked.length); i++) {
    picked.push(cards[i]);
    choose5(cards, i + 1, picked, out);
    picked.pop();
  }
  return out;
}

export function evaluateHand(heroCodes, boardCodes) {
  const hero = parseCards(heroCodes);
  const board = parseCards(boardCodes);
  const all = [...hero, ...board];
  if (hero.length !== 2 || all.length < 5) return null;
  let best = null;
  for (const combo of choose5(all)) {
    const s = score5(combo);
    if (!best || compareScore(s, best) > 0) best = s;
  }
  const boardTop = Math.max(0, ...board.map((c) => c.value));
  const pocket = hero[0].value === hero[1].value;
  const heroPairBoard = hero.some((h) => board.some((b) => b.value === h.value));
  let relative = 'fraca';
  if (best.tier >= 6) relative = 'nuts ou quase nuts';
  else if (best.tier >= 4) relative = 'mão forte';
  else if (best.tier === 3) relative = 'mão forte';
  else if (best.tier === 2) relative = 'mão média / showdown value';
  else if (best.tier === 1) {
    const pairRank = best.tie[0] || 0;
    if ((pocket && pairRank > boardTop) || (heroPairBoard && pairRank >= boardTop)) relative = 'mão média / showdown value';
    else relative = 'bluff catcher';
  }
  return { ...best, relative, hero, board };
}

export function boardTexture(boardCodes) {
  const board = parseCards(boardCodes);
  if (board.length < 3) return { label: 'sem board', paired: false, monotone: false, twoTone: false, connected: false, highCard: 0 };
  const rankCounts = new Map(); const suitCounts = new Map();
  for (const c of board) { rankCounts.set(c.value,(rankCounts.get(c.value)||0)+1); suitCounts.set(c.suit,(suitCounts.get(c.suit)||0)+1); }
  const paired = [...rankCounts.values()].some((n) => n >= 2);
  const suitMax = Math.max(...suitCounts.values());
  const vals = [...new Set(board.map((c)=>c.value))]; if (vals.includes(14)) vals.push(1);
  let connected = false;
  for (let low=1; low<=10; low++) if ([0,1,2,3,4].map((x)=>low+x).filter((x)=>vals.includes(x)).length >= 3) connected = true;
  const monotone = suitMax >= 3; const twoTone = suitMax === 2;
  const bits = [paired?'pareado':null, monotone?'monotone':twoTone?'two-tone':null, connected?'conectado':null].filter(Boolean);
  return { label: bits.join(' + ') || 'seco', paired, monotone, twoTone, connected, highCard: Math.max(...board.map((c)=>c.value)) };
}

export function drawAnalysis(heroCodes, boardCodes) {
  const hero = parseCards(heroCodes); const board = parseCards(boardCodes); const all = [...hero,...board];
  if (hero.length !== 2 || board.length >= 5) return { flushDraw:false, straightDraw:false, comboDraw:false, cleanOuts:0, labels:[] };
  const suitCounts = new Map(); for (const c of all) suitCounts.set(c.suit,(suitCounts.get(c.suit)||0)+1);
  const flushDraw = [...suitCounts.entries()].some(([s,n]) => n === 4 && hero.some((c)=>c.suit===s));
  const vals = new Set(all.map((c)=>c.value)); if (vals.has(14)) vals.add(1);
  const heroVals = new Set(hero.flatMap((c)=>c.value===14?[14,1]:[c.value]));
  let straightDraw=false, open=false;
  for (let low=1; low<=10; low++) {
    const win=[low,low+1,low+2,low+3,low+4]; const present=win.filter((v)=>vals.has(v));
    if (present.length === 4 && present.some((v)=>heroVals.has(v))) { straightDraw=true; const miss=win.find((v)=>!vals.has(v)); if (miss===low || miss===low+4) open=true; }
  }
  const flushOuts = flushDraw ? 9 : 0; const straightOuts = straightDraw ? (open ? 8 : 4) : 0;
  const cleanOuts = flushDraw && straightDraw ? Math.max(0, flushOuts + straightOuts - 2) : flushOuts + straightOuts;
  const labels=[]; if (flushDraw) labels.push('flush draw'); if (straightDraw) labels.push(open?'OESD':'gutshot');
  return { flushDraw, straightDraw, straightDrawType: straightDraw?(open?'open-ended':'gutshot'):null, comboDraw: flushDraw&&straightDraw, cleanOuts, labels };
}
