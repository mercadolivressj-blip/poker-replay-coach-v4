/**
 * Núcleo determinístico de cartas: parsing rigoroso e avaliação de mão feita.
 * Nada aqui é estratégia — é fato verificável sobre cartas.
 *
 * Rigor de notação: "Jc"+"Td" é JTo e NUNCA JTs. O naipe é lido carta a carta.
 */

export const RANKS = "23456789TJQKA";

export type Card = { rank: number; suit: string; label: string };

const RANK_VALUE: Record<string, number> = Object.fromEntries(
  RANKS.split("").map((r, i) => [r, i + 2]),
);

export const rankChar = (rank: number): string => RANKS[rank - 2] ?? "?";

/** Aceita "As", "Td", "7h". Devolve null para qualquer coisa ilegível — nunca adivinha. */
export const parseCard = (raw: string | null | undefined): Card | null => {
  if (!raw) return null;
  const text = String(raw).trim();
  if (text.length < 2) return null;
  const r = text[0]!.toUpperCase();
  const s = text[1]!.toLowerCase();
  const rank = RANK_VALUE[r];
  if (!rank || !"shdc".includes(s)) return null;
  return { rank, suit: s, label: `${r}${s}` };
};

export const parseCards = (raw: (string | null | undefined)[] | null | undefined): Card[] =>
  (raw ?? []).map(parseCard).filter((c): c is Card => !!c);

/** Duas cartas distintas? Protege contra OCR duplicado. */
export const distinct = (cards: Card[]): boolean =>
  new Set(cards.map((c) => c.label)).size === cards.length;

/** Notação estrita da mão: "AA", "JTs", "JTo". */
export const holeCode = (hole: Card[]): string | null => {
  if (hole.length !== 2 || !distinct(hole)) return null;
  const [a, b] = [...hole].sort((x, y) => y.rank - x.rank) as [Card, Card];
  if (a.rank === b.rank) return `${rankChar(a.rank)}${rankChar(b.rank)}`;
  return `${rankChar(a.rank)}${rankChar(b.rank)}${a.suit === b.suit ? "s" : "o"}`;
};

export type HandCategory =
  | "carta alta"
  | "par"
  | "dois pares"
  | "trinca"
  | "sequência"
  | "flush"
  | "full house"
  | "quadra"
  | "straight flush";

export const CATEGORY_ORDER: HandCategory[] = [
  "carta alta",
  "par",
  "dois pares",
  "trinca",
  "sequência",
  "flush",
  "full house",
  "quadra",
  "straight flush",
];

export type MadeHand = {
  category: HandCategory;
  /** 0 = carta alta … 8 = straight flush. */
  rank: number;
  /** Ranks decisivos, do mais forte ao menos (desempate). */
  kickers: number[];
};

const uniqueDesc = (ns: number[]) => [...new Set(ns)].sort((a, b) => b - a);

/** Maior rank que fecha uma sequência dentro do conjunto (A-5 incluída). Null se não houver. */
const straightHigh = (ranks: number[]): number | null => {
  const set = new Set(ranks);
  if (set.has(14)) set.add(1);
  const all = [...set].sort((a, b) => b - a);
  for (const high of all) {
    if ([1, 2, 3, 4].every((d) => set.has(high - d))) return high;
  }
  return null;
};

/** Avalia a melhor mão de 5 dentro de 5, 6 ou 7 cartas. Determinístico e exaustivo. */
export const evaluateHand = (cards: Card[]): MadeHand | null => {
  if (cards.length < 5) return null;
  const ranks = cards.map((c) => c.rank);
  const bySuit = new Map<string, number[]>();
  for (const c of cards) bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c.rank]);
  const flushSuit = [...bySuit.entries()].find(([, rs]) => rs.length >= 5)?.[0] ?? null;

  if (flushSuit) {
    const flushRanks = bySuit.get(flushSuit)!;
    const sfHigh = straightHigh(flushRanks);
    if (sfHigh)
      return { category: "straight flush", rank: 8, kickers: [sfHigh === 5 ? 5 : sfHigh] };
  }

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const quads = groups.filter((g) => g[1] === 4).map((g) => g[0]);
  const trips = groups.filter((g) => g[1] === 3).map((g) => g[0]);
  const pairs = groups.filter((g) => g[1] === 2).map((g) => g[0]);

  if (quads.length) {
    const k = uniqueDesc(ranks.filter((r) => r !== quads[0])).slice(0, 1);
    return { category: "quadra", rank: 7, kickers: [quads[0]!, ...k] };
  }
  if (trips.length >= 2 || (trips.length === 1 && pairs.length >= 1)) {
    const three = trips[0]!;
    const pair = trips.length >= 2 ? Math.max(trips[1]!, ...pairs) : pairs[0]!;
    return { category: "full house", rank: 6, kickers: [three, pair] };
  }
  if (flushSuit) {
    const top5 = [...bySuit.get(flushSuit)!].sort((a, b) => b - a).slice(0, 5);
    return { category: "flush", rank: 5, kickers: top5 };
  }
  const st = straightHigh(ranks);
  if (st) return { category: "sequência", rank: 4, kickers: [st] };
  if (trips.length) {
    const k = uniqueDesc(ranks.filter((r) => r !== trips[0])).slice(0, 2);
    return { category: "trinca", rank: 3, kickers: [trips[0]!, ...k] };
  }
  if (pairs.length >= 2) {
    const [p1, p2] = [pairs[0]!, pairs[1]!].sort((a, b) => b - a) as [number, number];
    const k = uniqueDesc(ranks.filter((r) => r !== p1 && r !== p2)).slice(0, 1);
    return { category: "dois pares", rank: 2, kickers: [p1, p2, ...k] };
  }
  if (pairs.length === 1) {
    const k = uniqueDesc(ranks.filter((r) => r !== pairs[0])).slice(0, 3);
    return { category: "par", rank: 1, kickers: [pairs[0]!, ...k] };
  }
  return { category: "carta alta", rank: 0, kickers: uniqueDesc(ranks).slice(0, 5) };
};

export const compareHands = (a: MadeHand, b: MadeHand): number => {
  if (a.rank !== b.rank) return a.rank - b.rank;
  const n = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < n; i++) {
    const d = (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** Baralho restante: usado para contar outs sem inventar cartas já visíveis. */
export const remainingDeck = (known: Card[]): Card[] => {
  const seen = new Set(known.map((c) => c.label));
  const deck: Card[] = [];
  for (const r of RANKS)
    for (const s of "shdc") {
      const label = `${r}${s}`;
      if (!seen.has(label)) deck.push({ rank: RANK_VALUE[r]!, suit: s, label });
    }
  return deck;
};