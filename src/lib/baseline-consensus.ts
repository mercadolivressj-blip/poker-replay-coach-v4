/**
 * CONSENSO DA BASELINE COM POSIÇÃO PENDENTE (V2.4.2-hotfix).
 */
import { bigBlindOf, normalizeActions, parseChips } from "./poker-state";
import { chipsNear } from "./hero-anchor";
import { preflopBaselineDecision } from "./preflop-decision";

export const SYNCING_POSITION = "SINCRONIZANDO POSIÇÃO";
export const CONSENSUS_ENGINE = "PREFLOP V1 · CONSENSO DA BASELINE (posição pendente)";
export const UNOPENED_NON_BLIND: readonly string[] = ["UTG", "HJ", "CO", "BTN"];

const blindPair = (blinds: string | null | undefined): { sb: number; bb: number } | null => {
  const bb = bigBlindOf(blinds ?? null);
  if (bb === null || !(bb > 0)) return null;
  const parts = (blinds ?? "").match(/\d[\d.,]*/g) ?? [];
  const sb = parts.length >= 2 ? parseChips(parts[0]) : null;
  return { sb: sb && sb > 0 ? sb : bb / 2, bb };
};

export type PlausiblePositionsInput = { legalActions: readonly string[]; toCall: string | null | undefined; pot: string | null | undefined; blinds: string | null | undefined };
export const plausibleHeroPositions = (input: PlausiblePositionsInput): string[] => {
  const pair = blindPair(input.blinds); if (!pair) return [];
  const { sb, bb } = pair; const pot = parseChips(input.pot ?? null);
  if (pot === null || !chipsNear(pot, sb + bb, bb)) return [];
  const legal = normalizeActions([...input.legalActions]); if (!legal.length) return [];
  if (legal.includes("CHECK") && !legal.includes("CALL")) return ["BB"];
  if (!legal.includes("CALL")) return [];
  const toCall = parseChips(input.toCall ?? null); if (toCall === null || !(toCall > 0)) return [];
  if (chipsNear(toCall, bb - sb, bb)) return ["SB"];
  if (chipsNear(toCall, bb, bb)) return [...UNOPENED_NON_BLIND];
  return [];
};

export const POSITION_ORDER: readonly string[] = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
export type VsOpenPair = { hero: string; versus: string };
export const plausibleVsOpenPairs = (raiser?: string | null): VsOpenPair[] => {
  const known = raiser ? POSITION_ORDER.indexOf(raiser) : -1; const pairs: VsOpenPair[] = [];
  for (let h = 1; h < POSITION_ORDER.length; h++) for (let v = 0; v < h; v++) { if (known >= 0 && v !== known) continue; pairs.push({ hero: POSITION_ORDER[h]!, versus: POSITION_ORDER[v]! }); }
  return pairs;
};

export type BaselineConsensusInput = {
  heroCards: string[]; board: string[]; legalActions: string[]; blinds: string | null | undefined;
  pot: string | null | undefined; toCall: string | null | undefined; depthBB: number | null | undefined;
  format?: string | null; tableSize?: string | null; decisionKey?: string | null; unopened: boolean;
  node?: "rfi" | "vs_open" | null; versus?: string | null;
};
export type BaselineConsensusDecision = { advice: string; actionCode: "FOLD" | "CALL" | "RAISE" | "CHECK"; engine: string; reason: string; positions: string[] };

export const baselineConsensusDecision = (input: BaselineConsensusInput): BaselineConsensusDecision | null => {
  if (input.board.length !== 0 || input.heroCards.length !== 2) return null;
  if (!input.unopened) {
    if (input.node !== "vs_open") return null;
    const pairs = plausibleVsOpenPairs(input.versus ?? null); if (!pairs.length) return null;
    let agreedVs: BaselineConsensusDecision | null = null;
    for (const pair of pairs) {
      const result = preflopBaselineDecision({ heroCards: input.heroCards, board: input.board, heroPosition: pair.hero, legalActions: input.legalActions, node: "vs_open", versus: pair.versus, multiway: false, depthBB: input.depthBB ?? null, format: input.format ?? "cash", tableSize: input.tableSize ?? "6max", decisionKey: input.decisionKey ?? "" });
      if (!result || result.kind !== "decision") return null;
      if (agreedVs && agreedVs.actionCode !== result.actionCode) return null;
      if (!agreedVs) agreedVs = { advice: result.advice, actionCode: result.actionCode, engine: CONSENSUS_ENGINE, reason: `A posição exata do herói ainda não fechou, mas diante deste aumento a baseline congelada indica a MESMA jogada (${result.advice}) em todas as combinações plausíveis de posição/abridor. Decisão da baseline, não aproximação.`, positions: Array.from(new Set(pairs.map((p) => p.hero))) };
    }
    return agreedVs;
  }
  const positions = plausibleHeroPositions({ legalActions: input.legalActions, toCall: input.toCall, pot: input.pot, blinds: input.blinds });
  if (!positions.length) return null;
  let agreed: BaselineConsensusDecision | null = null;
  for (const position of positions) {
    const result = preflopBaselineDecision({ heroCards: input.heroCards, board: input.board, heroPosition: position, legalActions: input.legalActions, node: "rfi", versus: null, multiway: false, depthBB: input.depthBB ?? null, format: input.format ?? "cash", tableSize: input.tableSize ?? "6max", decisionKey: input.decisionKey ?? "" });
    if (!result || result.kind !== "decision") return null;
    if (agreed && agreed.actionCode !== result.actionCode) return null;
    if (!agreed) agreed = { advice: result.advice, actionCode: result.actionCode, engine: CONSENSUS_ENGINE, reason: `A posição exata do herói ainda não fechou, mas a baseline congelada indica a MESMA jogada (${result.advice}) em todas as posições compatíveis com o preço e o pote observados (${positions.join(", ")}). Decisão da baseline, não aproximação.`, positions };
  }
  return agreed;
};

export const TIGHTEST_ENGINE = "PREFLOP V1 · BASELINE (POSIÇÃO MAIS CONSERVADORA)";
export const baselineTightestDecision = (input: BaselineConsensusInput): BaselineConsensusDecision | null => {
  if (input.board.length !== 0 || input.heroCards.length !== 2) return null;
  const evaluate = (heroPosition: string, node: "rfi" | "vs_open", versus: string | null) => preflopBaselineDecision({ heroCards: input.heroCards, board: input.board, heroPosition, legalActions: input.legalActions, node, versus, multiway: false, depthBB: input.depthBB ?? null, format: input.format ?? "cash", tableSize: input.tableSize ?? "6max", decisionKey: input.decisionKey ?? "" });
  const tightestOf = (candidates: { hero: string; versus: string | null }[], node: "rfi" | "vs_open") => {
    const sorted = [...candidates].sort((a, b) => POSITION_ORDER.indexOf(a.hero) - POSITION_ORDER.indexOf(b.hero));
    for (const candidate of sorted) {
      const result = evaluate(candidate.hero, node, candidate.versus); if (!result || result.kind !== "decision") continue;
      return { advice: result.advice, actionCode: result.actionCode, engine: TIGHTEST_ENGINE, reason: `A posição exata do herói ainda não fechou. Entre as posições plausíveis, a baseline congelada é lida na mais conservadora (${candidate.hero}${candidate.versus ? ` vs ${candidate.versus}` : ""}): ${result.advice}. Decisão da baseline, não aproximação.`, positions: sorted.map((c) => c.hero) } satisfies BaselineConsensusDecision;
    }
    return null;
  };
  if (!input.unopened) {
    if (input.node !== "vs_open") return null;
    const pairs = plausibleVsOpenPairs(input.versus ?? null); if (!pairs.length) return null;
    return tightestOf(pairs.map((p) => ({ hero: p.hero, versus: p.versus })), "vs_open");
  }
  const positions = plausibleHeroPositions({ legalActions: input.legalActions, toCall: input.toCall, pot: input.pot, blinds: input.blinds });
  if (!positions.length) return null;
  return tightestOf(positions.map((hero) => ({ hero, versus: null })), "rfi");
};
