/**
 * Força da mão pós-flop, draws e outs — tudo determinístico e recalculado por street.
 *
 * REGRA CENTRAL: nada é herdado da street anterior. Um OESD do turn que morreu no river
 * simplesmente não existe aqui, porque a função só olha para as cartas confirmadas AGORA.
 */
import {
  compareHands,
  evaluateHand,
  parseCards,
  rankChar,
  remainingDeck,
  type Card,
  type MadeHand,
} from "./cards";

export type RelativeStrength =
  | "nuts ou quase nuts"
  | "mão forte"
  | "mão média / showdown value"
  | "bluff catcher"
  | "mão fraca / sem showdown";

export type MadeHandRead = {
  made: MadeHand;
  /** Descrição relativa: top pair, segundo par, overpair, etc. */
  detail: string;
  usesHole: number;
  /** true quando a melhor mão de 5 está inteira no board (hero não melhora nada). */
  playingTheBoard: boolean;
  strength: RelativeStrength;
};

export type DrawRead = {
  flushDraw: boolean;
  nutFlushDraw: boolean;
  backdoorFlush: boolean;
  oesd: boolean;
  gutshot: boolean;
  doubleGutter: boolean;
  backdoorStraight: boolean;
  overcards: number;
  comboDraw: boolean;
  labels: string[];
};

export type OutsRead = {
  rawOuts: number;
  cleanOuts: number;
  contaminated: number;
  /** Cartas (rótulo) que melhoram a mão para algo forte. */
  outCards: string[];
  note: string;
};

export type Blockers = {
  labels: string[];
  blocksNutFlush: boolean;
  blocksTopSet: boolean;
  blocksStraight: boolean;
};

export type HandStrengthRead = {
  street: "flop" | "turn" | "river";
  madeHand: MadeHandRead;
  draws: DrawRead;
  outs: OutsRead | null;
  blockers: Blockers;
};

const STRONG_RANK = 2; // dois pares ou melhor

const pairDetail = (hole: Card[], board: Card[], made: MadeHand): string => {
  const boardRanks = [...new Set(board.map((c) => c.rank))].sort((a, b) => b - a);
  const holeRanks = hole.map((c) => c.rank).sort((a, b) => b - a);
  const pairRank = made.kickers[0]!;
  const pocket = holeRanks[0] === holeRanks[1];
  if (made.category !== "par") return "";
  if (pocket && pairRank === holeRanks[0]) {
    if (pairRank > boardRanks[0]!) return "overpair (par na mão acima do board)";
    return `par na mão abaixo do ${rankChar(boardRanks[0]!)} do board (underpair)`;
  }
  if (!holeRanks.includes(pairRank))
    return "par que está no próprio board (o herói não tem par próprio)";
  const idx = boardRanks.indexOf(pairRank);
  if (idx === 0) {
    const kicker = holeRanks.find((r) => r !== pairRank);
    const kickerText = kicker ? ` com kicker ${rankChar(kicker)}` : "";
    return `top pair${kickerText}`;
  }
  if (idx === 1) return "segundo par";
  if (idx === 2) return "terceiro par";
  if (idx > 2) return "par baixo do board";
  return "par usando o board";
};

const strengthOf = (
  made: MadeHand,
  detail: string,
  board: Card[],
  playingTheBoard: boolean,
  hole: Card[] = [],
): RelativeStrength => {
  if (playingTheBoard) return "mão fraca / sem showdown";
  const paired = new Set(board.map((c) => c.rank)).size < board.length;
  const suitCount = new Map<string, number>();
  for (const c of board) suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1);
  const threeFlush = Math.max(...suitCount.values()) >= 3;

  if (made.rank >= 6) return "nuts ou quase nuts";
  if (made.rank === 5) {
    // Flush baixo não é nuts: quantas cartas do naipe ainda não vistas batem o herói?
    const suit = [...suitCount.entries()].find(([, n]) => n >= 3)?.[0];
    const heroTop = Math.max(0, ...hole.filter((c) => c.suit === suit).map((c) => c.rank));
    const seen = new Set([...board, ...hole].filter((c) => c.suit === suit).map((c) => c.rank));
    let better = 0;
    for (let r = heroTop + 1; r <= 14; r++) if (!seen.has(r)) better++;
    if (paired) return "mão forte";
    if (better === 0) return "nuts ou quase nuts";
    if (better <= 2) return "mão forte";
    return "mão média / showdown value";
  }
  if (made.rank === 4) return paired ? "mão forte" : "nuts ou quase nuts";
  if (made.rank === 3) return paired ? "mão forte" : "nuts ou quase nuts";
  if (made.rank === 2) return paired || threeFlush ? "bluff catcher" : "mão forte";
  if (made.rank === 1) {
    if (detail.startsWith("par que está no próprio board")) return "mão fraca / sem showdown";
    if (detail.startsWith("overpair"))
      return paired || threeFlush ? "bluff catcher" : "mão forte";
    if (detail.startsWith("top pair"))
      return paired || threeFlush ? "bluff catcher" : "mão média / showdown value";
    return "bluff catcher";
  }
  return "mão fraca / sem showdown";
};

export const readMadeHand = (hole: Card[], board: Card[]): MadeHandRead | null => {
  const made = evaluateHand([...hole, ...board]);
  const boardOnly = board.length >= 5 ? evaluateHand(board) : null;
  if (!made) return null;
  const playingTheBoard = !!boardOnly && compareHands(made, boardOnly) === 0;
  const detail = pairDetail(hole, board, made);
  // Quantas cartas do herói participam: recalculado por força bruta simples.
  let usesHole = 0;
  for (const c of hole) {
    const without = evaluateHand([...hole.filter((h) => h.label !== c.label), ...board]);
    if (!without || compareHands(made, without) > 0) usesHole++;
  }
  return {
    made,
    detail: detail || made.category,
    usesHole,
    playingTheBoard,
    strength: strengthOf(made, detail, board, playingTheBoard, hole),
  };
};

/** Ranks que completam uma sequência usando pelo menos uma carta do herói. */
const straightCompletingRanks = (hole: Card[], board: Card[]): number[] => {
  const current = evaluateHand([...hole, ...board]);
  const out: number[] = [];
  for (let r = 2; r <= 14; r++) {
    const card: Card = { rank: r, suit: "x", label: `${rankChar(r)}x` };
    const after = evaluateHand([...hole, ...board, card]);
    if (!after) continue;
    if (after.category === "sequência" && (!current || current.rank < 4)) {
      // precisa usar carta do herói
      const withoutHole = evaluateHand([...board, card]);
      if (!withoutHole || withoutHole.category !== "sequência") out.push(r);
    }
  }
  return out;
};

export const readDraws = (hole: Card[], board: Card[]): DrawRead => {
  const river = board.length === 5;
  const all = [...hole, ...board];
  const suitCount = new Map<string, number>();
  for (const c of all) suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1);

  let flushDraw = false;
  let nutFlushDraw = false;
  let backdoorFlush = false;
  for (const [suit, count] of suitCount) {
    const heroHas = hole.some((c) => c.suit === suit);
    if (!heroHas) continue;
    if (count === 4 && !river) {
      flushDraw = true;
      const missingHigher = [14, 13, 12].filter(
        (r) => !all.some((c) => c.suit === suit && c.rank === r),
      );
      const heroTop = Math.max(...hole.filter((c) => c.suit === suit).map((c) => c.rank));
      if (heroTop === 14 || missingHigher.every((r) => r < heroTop)) nutFlushDraw = true;
    }
    if (count === 3 && board.length === 3) backdoorFlush = true;
  }

  const completing = river ? [] : straightCompletingRanks(hole, board);
  // OESD = 4 cartas seguidas: as duas pontas que completam ficam a 5 ranks de distância.
  // Distância maior = dois gutshots separados (double gutter).
  const spread = completing.length >= 2 ? Math.max(...completing) - Math.min(...completing) : 0;
  const oesd = completing.length === 2 && spread === 5;
  const doubleGutter = completing.length >= 2 && !oesd;
  const gutshot = completing.length === 1 || (completing.length >= 2 && !oesd && !doubleGutter);

  // Backdoor straight só existe no flop: 3 cartas dentro de uma janela de 5 usando o herói.
  let backdoorStraight = false;
  if (board.length === 3 && completing.length === 0) {
    const ranks = new Set(all.map((c) => c.rank));
    if (ranks.has(14)) ranks.add(1);
    for (let low = 1; low <= 10; low++) {
      const window = [low, low + 1, low + 2, low + 3, low + 4];
      const hit = window.filter((r) => ranks.has(r));
      const heroIn = hole.some((c) => window.includes(c.rank) || (c.rank === 14 && window.includes(1)));
      if (hit.length >= 3 && heroIn) backdoorStraight = true;
    }
  }

  const made = evaluateHand([...hole, ...board]);
  const boardHigh = Math.max(...board.map((c) => c.rank));
  const overcards =
    made && made.rank === 0 ? hole.filter((c) => c.rank > boardHigh).length : 0;

  const comboDraw = flushDraw && (oesd || gutshot || doubleGutter);
  const labels: string[] = [];
  if (nutFlushDraw) labels.push("nut flush draw");
  else if (flushDraw) labels.push("flush draw");
  if (oesd) labels.push("OESD");
  if (doubleGutter) labels.push("double gutter");
  else if (gutshot && !oesd) labels.push("gutshot");
  if (backdoorFlush) labels.push("backdoor flush");
  if (backdoorStraight) labels.push("backdoor straight");
  if (overcards) labels.push(`${overcards} overcard${overcards > 1 ? "s" : ""}`);
  if (comboDraw) labels.push("combo draw");
  if (river) labels.push("river: não existe mais draw");

  return {
    flushDraw,
    nutFlushDraw,
    backdoorFlush,
    oesd,
    gutshot: gutshot && !oesd,
    doubleGutter,
    backdoorStraight,
    overcards,
    comboDraw,
    labels: labels.length ? labels : ["sem draw"],
  };
};

/**
 * Outs BRUTOS vs outs LIMPOS.
 * Bruto = carta que leva o herói a dois pares ou melhor (ou melhora mão feita para straight+).
 * Contaminado = a mesma carta que completa flush de 3 no board fora do naipe do herói,
 * ou que pareia o board quando a melhora do herói é sequência/flush (risco de full house).
 */
export const readOuts = (hole: Card[], board: Card[]): OutsRead | null => {
  if (board.length >= 5) return null; // river: não existe carta por vir
  const current = evaluateHand([...hole, ...board]);
  if (!current) return null;
  // Outs só fazem sentido para mão que PRECISA melhorar. Mão feita forte não "conta outs".
  if (current.rank >= 2) return null;
  const target = Math.max(STRONG_RANK, current.rank + 1);
  const deck = remainingDeck([...hole, ...board]);
  const boardSuits = new Map<string, number>();
  for (const c of board) boardSuits.set(c.suit, (boardSuits.get(c.suit) ?? 0) + 1);

  const outCards: string[] = [];
  let contaminated = 0;
  for (const card of deck) {
    const after = evaluateHand([...hole, ...board, card]);
    if (!after || after.rank < target) continue;
    // Melhora que acontece igual no board (herói jogando o board) não é out do herói.
    const boardOnly = evaluateHand([...board, card]);
    if (boardOnly && compareHands(after, boardOnly) <= 0) continue;
    outCards.push(card.label);
    const heroSuit = hole.some((c) => c.suit === card.suit);
    const makesBoardFlushy = (boardSuits.get(card.suit) ?? 0) >= 3 && !heroSuit;
    const pairsBoard = board.some((c) => c.rank === card.rank);
    const straightOrFlush = after.rank === 4 || after.rank === 5;
    if (makesBoardFlushy || (pairsBoard && straightOrFlush)) contaminated++;
  }
  const rawOuts = outCards.length;
  const cleanOuts = Math.max(0, Math.round((rawOuts - contaminated * 0.5) * 10) / 10);
  return {
    rawOuts,
    cleanOuts,
    contaminated,
    outCards,
    note: contaminated
      ? `${rawOuts} outs brutos, ${contaminated} contaminados (completam flush do vilão ou pareiam o board) → ${cleanOuts} outs limpos.`
      : `${rawOuts} outs limpos.`,
  };
};

export const readBlockers = (hole: Card[], board: Card[]): Blockers => {
  const labels: string[] = [];
  const suitCount = new Map<string, number>();
  for (const c of board) suitCount.set(c.suit, (suitCount.get(c.suit) ?? 0) + 1);
  const flushSuit = [...suitCount.entries()].find(([, n]) => n >= 3)?.[0] ?? null;
  const blocksNutFlush = !!flushSuit && hole.some((c) => c.suit === flushSuit && c.rank === 14);
  if (blocksNutFlush) labels.push("bloqueia o flush máximo (ás do naipe)");
  const blocksTopSet = hole.some((c) => c.rank === Math.max(...board.map((b) => b.rank)));
  if (blocksTopSet) labels.push("bloqueia parte das trincas de carta alta");
  const straightRanks = new Set(board.map((c) => c.rank));
  const blocksStraight = hole.some(
    (c) => [...straightRanks].some((r) => Math.abs(r - c.rank) <= 2) && c.rank >= 9,
  );
  if (blocksStraight) labels.push("bloqueia parte das sequências");
  return { labels, blocksNutFlush, blocksTopSet, blocksStraight };
};

export const readHandStrength = (
  heroCards: (string | null | undefined)[],
  boardCards: (string | null | undefined)[],
): HandStrengthRead | null => {
  const hole = parseCards(heroCards);
  const board = parseCards(boardCards);
  if (hole.length !== 2) return null;
  if (board.length < 3 || board.length > 5) return null;
  const madeHand = readMadeHand(hole, board);
  if (!madeHand) return null;
  return {
    street: board.length === 3 ? "flop" : board.length === 4 ? "turn" : "river",
    madeHand,
    draws: readDraws(hole, board),
    outs: readOuts(hole, board),
    blockers: readBlockers(hole, board),
  };
};