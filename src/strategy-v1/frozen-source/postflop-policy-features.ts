/**
 * FEATURES DA POLICY PÓS-FLOP (V4).
 *
 * Um único lugar constrói o vetor de features — o MESMO código é usado para gerar o dataset
 * de treino offline e para inferir em produção. Isso elimina divergência treino/produção.
 *
 * Regra dura: as features saem SEMPRE do motor determinístico (estado + matemática já
 * calculados). A policy nunca lê carta, pote, preço ou ação legal por fora do motor.
 *
 * Valor ausente = NaN (o modelo trata missing values nativamente); nada é imputado com zero,
 * porque zero é um número com significado estratégico (pote 0, preço 0).
 */
import type { PostflopAnalysis } from "./postflop";
import { parseCards } from "./cards";

const NA = Number.NaN;
const num = (v: number | null | undefined) => (v == null ? NA : v);
const bool = (v: boolean | null | undefined) => (v == null ? NA : v ? 1 : 0);
const idx = <T extends string>(list: readonly T[], v: T | null | undefined) =>
  v == null ? NA : list.indexOf(v);

const STREETS = ["flop", "turn", "river"] as const;
const POT_TYPES = ["SRP", "3BP", "4BP+"] as const;
const REL = [
  "mão fraca / sem showdown",
  "bluff catcher",
  "mão média / showdown value",
  "mão forte",
  "nuts ou quase nuts",
] as const;
const STATUS = [
  "indeterminado",
  "bluff puro",
  "bluff catcher",
  "semi-bluff",
  "showdown value",
  "thin value",
  "strong value",
] as const;
const SUITP = ["rainbow", "two-tone", "monotone"] as const;
const WET = ["dry", "semi-wet", "wet"] as const;
const PROFILE = ["low-card", "misto", "high-card", "broadway-heavy"] as const;
const ADV = ["indeterminado", "vilão", "disputado", "herói"] as const;

/** Nomes na MESMA ordem do vetor. O artefato treinado guarda esta lista e ela é conferida. */
export const FEATURE_NAMES = [
  "street",
  "potType",
  "heroIP",
  "heroPFA",
  "multiway",
  "playersInHand",
  "facing",
  "pot",
  "call",
  "betPctOfPot",
  "requiredEquity",
  "mdf",
  "foldEquityNeeded",
  "spr",
  "effDepthBB",
  "cleanOuts",
  "drawEquity",
  "equityMinusRequired",
  "madeRank",
  "usesHole",
  "playingTheBoard",
  "relStrength",
  "vbStatus",
  "flushDraw",
  "nutFlushDraw",
  "backdoorFlush",
  "oesd",
  "gutshot",
  "doubleGutter",
  "backdoorStraight",
  "overcards",
  "comboDraw",
  "nBlockers",
  "blocksNutFlush",
  "blocksTopSet",
  "blocksStraight",
  "suitPattern",
  "paired",
  "doublePaired",
  "trips",
  "connected",
  "flushPossible",
  "straightPossible",
  "wetness",
  "dynamic",
  "boardHigh",
  "boardProfile",
  "boardSecond",
  "boardLow",
  "boardSpan",
  "boardDistinctRanks",
  "boardMaxSuitCount",
  "heroHigh",
  "heroLow",
  "heroSuited",
  "heroPocket",
  "heroGap",
  "heroOvercardsToBoard",
  "heroConnectsBoard",
  "canCheck",
  "canBet",
  "canCall",
  "canFold",
  "canRaise",
  "canAllIn",
  "nLegal",
  "streetActions",
  "streetRaises",
  "handActions",
  "villainBetChips",
  "villainBetPctPot",
  "heroInvestedStreet",
  "allInEvidence",
  "stateConfidence",
] as const;

export type FeatureVector = number[];

/** Vetor de features de UM spot. Determinístico e puro. */
export const policyFeatures = (a: PostflopAnalysis): FeatureVector => {
  const st = a.street === "analisando" ? null : a.street;
  const m = a.math;
  const t = a.texture;
  const s = a.strength;
  const la = a.legalActions;
  const has = (x: string) => (la.includes(x) ? 1 : 0);

  const bs = boardStats(a);
  const hs = heroStats(a, bs);

  const streetActs = st ? a.line.byStreet[st] ?? [] : [];
  const villainBet =
    [...streetActs].reverse().find((x) => (x.action === "BET" || x.action === "RAISE" || x.action === "ALLIN") && x.amount != null)
      ?.amount ?? null;
  const heroInvested = streetActs
    .filter((x) => x.amount != null)
    .reduce((acc, x) => Math.max(acc, x.amount ?? 0), 0);

  const eq = m.drawEquity;
  const req = m.requiredEquity;

  return [
    idx(STREETS, st),
    idx(POT_TYPES, a.range.potType),
    bool(a.range.heroInPosition),
    bool(a.range.heroIsPreflopAggressor),
    bool(a.range.multiway),
    num(a.range.playersInHand),
    (m.callChips ?? 0) > 0 ? 1 : 0,
    num(m.potChips),
    num(m.callChips),
    num(m.betPctOfPot),
    num(req),
    num(m.mdf),
    num(m.foldEquityNeeded),
    num(m.spr),
    num(m.effectiveDepthBB),
    num(m.cleanOuts),
    num(eq),
    eq != null && req != null ? eq - req : NA,
    s ? s.madeHand.made.rank : NA,
    s ? s.madeHand.usesHole : NA,
    s ? bool(s.madeHand.playingTheBoard) : NA,
    s ? idx(REL, s.madeHand.strength) : NA,
    idx(STATUS, a.valueBluff.status),
    s ? bool(s.draws.flushDraw) : NA,
    s ? bool(s.draws.nutFlushDraw) : NA,
    s ? bool(s.draws.backdoorFlush) : NA,
    s ? bool(s.draws.oesd) : NA,
    s ? bool(s.draws.gutshot) : NA,
    s ? bool(s.draws.doubleGutter) : NA,
    s ? bool(s.draws.backdoorStraight) : NA,
    s ? s.draws.overcards : NA,
    s ? bool(s.draws.comboDraw) : NA,
    s ? s.blockers.labels.length : NA,
    s ? bool(s.blockers.blocksNutFlush) : NA,
    s ? bool(s.blockers.blocksTopSet) : NA,
    s ? bool(s.blockers.blocksStraight) : NA,
    t ? idx(SUITP, t.suitPattern) : NA,
    t ? bool(t.paired) : NA,
    t ? bool(t.doublePaired) : NA,
    t ? bool(t.trips) : NA,
    t ? bool(t.connected) : NA,
    t ? bool(t.flushPossible) : NA,
    t ? bool(t.straightPossible) : NA,
    t ? idx(WET, t.wetness) : NA,
    t ? (t.dynamism === "dynamic" ? 1 : 0) : NA,
    t ? t.highCard : NA,
    t ? idx(PROFILE, t.profile) : NA,
    bs.second,
    bs.low,
    bs.span,
    bs.distinct,
    bs.maxSuit,
    hs.high,
    hs.low,
    hs.suited,
    hs.pocket,
    hs.gap,
    hs.overcards,
    hs.connects,
    has("CHECK"),
    has("BET"),
    has("CALL"),
    has("FOLD"),
    has("RAISE"),
    has("ALLIN"),
    la.length,
    streetActs.length,
    streetActs.filter((x) => x.action === "RAISE").length,
    a.line.actions.length,
    num(villainBet),
    villainBet != null && m.potChips ? Math.round((villainBet / m.potChips) * 1000) / 10 : NA,
    heroInvested,
    a.allInEvidence ? 1 : 0,
    a.strategicConfidence === "alta" ? 2 : a.strategicConfidence === "media" ? 1 : 0,
  ];
};

type BoardStats = { second: number; low: number; span: number; distinct: number; maxSuit: number; ranks: number[] };

/** Estatísticas de rank/naipe do board a partir do texto já validado pelo motor. */
const boardStats = (a: PostflopAnalysis): BoardStats => {
  const cards = parseCards(boardLabels(a));
  if (!cards.length) return { second: NA, low: NA, span: NA, distinct: NA, maxSuit: NA, ranks: [] };
  const ranks = cards.map((c) => c.rank).sort((x, y) => y - x);
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  return {
    second: ranks[1] ?? NA,
    low: ranks[ranks.length - 1] ?? NA,
    span: (ranks[0] ?? 0) - (ranks[ranks.length - 1] ?? 0),
    distinct: new Set(ranks).size,
    maxSuit: Math.max(...counts.values()),
    ranks,
  };
};

const heroStats = (a: PostflopAnalysis, bs: BoardStats) => {
  const cards = parseCards(heroLabels(a));
  if (cards.length !== 2)
    return { high: NA, low: NA, suited: NA, pocket: NA, gap: NA, overcards: NA, connects: NA };
  const r = cards.map((c) => c.rank).sort((x, y) => y - x);
  const boardHigh = bs.ranks[0];
  return {
    high: r[0]!,
    low: r[1]!,
    suited: cards[0]!.suit === cards[1]!.suit ? 1 : 0,
    pocket: r[0] === r[1] ? 1 : 0,
    gap: r[0]! - r[1]!,
    overcards: boardHigh == null ? NA : r.filter((x) => x > boardHigh).length,
    connects: bs.ranks.length ? r.filter((x) => bs.ranks.includes(x)).length : NA,
  };
};

/** O motor guarda as cartas confirmadas no bloco de prompt; expostas aqui de forma estável. */
const boardLabels = (a: PostflopAnalysis): string[] => a.cards.board;
const heroLabels = (a: PostflopAnalysis): string[] => a.cards.hero;