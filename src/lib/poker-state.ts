const RANK_ORDER = "23456789TJQKA";

export const actionCode = (text: string): string | null => {
  const value = text.trim().toUpperCase();
  if (value.includes("DESIST") || value.startsWith("FOLD")) return "FOLD";
  if (value.includes("ALL-IN") || value.includes("ALL IN") || value.includes("ALLIN")) return "ALLIN";
  if (value.includes("PASS") || value.includes("PUL") || value.startsWith("CHECK")) return "CHECK";
  if (value.includes("PAG") || value.startsWith("CALL")) return "CALL";
  if (value.includes("AUMENT") || value.startsWith("RAISE")) return "RAISE";
  if (value.includes("APOST") || value.startsWith("BET")) return "BET";
  return null;
};

export const normalizeActions = (actions: string[]) => {
  const normalized = [...new Set(actions.map(actionCode).filter((v): v is string => !!v))];
  const impossible =
    (normalized.includes("CHECK") && normalized.includes("CALL")) ||
    (normalized.includes("BET") && normalized.includes("RAISE")) ||
    (normalized.length === 1 && normalized[0] === "FOLD");
  return impossible ? [] : normalized;
};

export const actionSignature = (actions: string[]) => normalizeActions(actions).sort().join("|");

export const canonicalAmount = (value: string | null | undefined): string | null => {
  const n = parseChips(value);
  return n === null ? null : n.toFixed(4);
};

export const decisionSnapshotKey = (snapshot: {
  handId: number;
  heroCards: string[];
  board: string[];
  toCall: string | null;
  legalActions: string[];
  heroStack?: string | null;
  effectiveStack?: string | null;
  blinds?: string | null;
  heroPosition?: string | null;
}) =>
  JSON.stringify([
    snapshot.handId,
    cardSetKey(snapshot.heroCards),
    snapshot.board.join(""),
    canonicalAmount(snapshot.toCall),
    actionSignature(snapshot.legalActions),
    parseChips(snapshot.heroStack),
    parseChips(snapshot.effectiveStack),
    bigBlindOf(snapshot.blinds),
    snapshot.heroPosition?.trim().toUpperCase() ?? null,
  ]);

export const isConfirmedHandEnd = (hasCurrentHero: boolean, missingHeroReads: number, missingActionReads: number) =>
  hasCurrentHero && missingHeroReads >= 2 && missingActionReads >= 2;

export const adviceIsLegal = (advice: string, legalActions: string[]) => {
  const claimed = actionCode(advice);
  const legal = normalizeActions(legalActions);
  return !!claimed && legal.length > 0 && legal.includes(claimed);
};

export const canonicalCards = (cards: string[]) =>
  [...cards].sort((a, b) => {
    const rank = RANK_ORDER.indexOf(b[0] ?? "") - RANK_ORDER.indexOf(a[0] ?? "");
    return rank || a.localeCompare(b);
  });

export const cardSetKey = (cards: string[]) => canonicalCards(cards).join("|");
export const rankSetKey = (cards: string[]) => canonicalCards(cards).map((card) => card[0] ?? "").sort().join("|");

export const isConfirmedHeroReplacement = (
  current: string[], candidate: string[], votes: number, requiredVotes: number, hasPhysicalTransitionEvidence: boolean,
) => current.length === 2 && candidate.length === 2 && cardSetKey(candidate) !== cardSetKey(current) && votes >= requiredVotes && hasPhysicalTransitionEvidence;

export const parseChips = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const cleaned = value.replace(/\s/g, "");
  const k = /k\b/i.test(cleaned) || /\dk$/i.test(cleaned);
  const token = cleaned.match(/\d[\d.,]*/)?.[0];
  if (!token) return null;
  const normalized = k
    ? token.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}([.,]\d{3})+$/.test(token)
      ? token.replace(/[.,]/g, "")
      : /^\d+[.,]\d{1,2}$/.test(token)
        ? token.replace(",", ".")
        : token.replace(/\./g, "").replace(",", ".");
  const match = normalized.match(/[\d.]+/);
  if (!match) return null;
  let n = Number(match[0]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (k) n *= 1000;
  return n;
};

export const bigBlindOf = (blinds: string | null | undefined): number | null => {
  const text = blinds ?? "";
  const slash = text.match(/([\d.,]+)\s*\/\s*([\d.,]+)/);
  if (slash) return parseChips(slash[2]);
  const labelled = text.match(/(?:BB|BIG\s*BLIND)\s*[:=]?\s*([\d.,]+)/i);
  if (labelled) return parseChips(labelled[1]);
  return null;
};

export const canonicalBlinds = (blinds: string | null | undefined): string | null => {
  if (!blinds || !blinds.trim()) return null;
  const parts = blinds.match(/\d[\d.,]*/g);
  if (!parts?.length) return null;
  const values = parts.map((p) => parseChips(p)).filter((n): n is number => n !== null);
  if (!values.length) return null;
  return values.map((n) => n.toFixed(4)).join("/");
};

export type DepthRegime = "critico" | "curto" | "medio-curto" | "normal";
export const depthBB = (
  heroStack: string | null | undefined,
  effectiveStack: string | null | undefined,
  blinds: string | null | undefined,
): { depth: number; regime: DepthRegime } | null => {
  const stack = parseChips(effectiveStack) ?? parseChips(heroStack);
  const bb = bigBlindOf(blinds);
  if (!stack || !bb) return null;
  const depth = Math.round((stack / bb) * 10) / 10;
  const regime: DepthRegime = depth <= 8 ? "critico" : depth <= 15 ? "curto" : depth <= 25 ? "medio-curto" : "normal";
  return { depth, regime };
};

export const potOdds = (
  pot: string | null | undefined,
  toCall: string | null | undefined,
): { call: number; pot: number; finalPot: number; requiredEquity: number } | null => {
  const p = parseChips(pot);
  const c = parseChips(toCall);
  if (!p || !c) return null;
  const finalPot = p + c;
  const requiredEquity = Math.round((c / finalPot) * 1000) / 10;
  return { call: c, pot: p, finalPot, requiredEquity };
};
