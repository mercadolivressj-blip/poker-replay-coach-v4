/**
 * PRÉ-FLOP DIRETO (V2.3) — o cérebro congelado decide, a IA só explica.
 *
 * Análogo a `productionPostflopDecision`: nos nodes cobertos pela baseline
 * auditada (cash6max-100z-highrake-v1), a ação exibida sai do CHART, passa pela
 * máscara legal e vai para o latch. Gemini deixa de escolher a ação nesses
 * spots — fica apenas com a explicação.
 *
 * NADA de range, distribuição, peso ou threshold é alterado aqui: este módulo
 * apenas LÊ `lookupPreflop` e apresenta o resultado.
 */

import { normalizeActions } from "./poker-state";
import { classifyPreflopNode, lookupPreflop, normalizePosition } from "./ranges-6max";
import type { ActionDistribution, ActionKey } from "./ranges-100z";

export type PreflopDirectInput = {
  heroCards: string[];
  board: string[];
  heroPosition: string | null | undefined;
  legalActions: string[];
  actionHistory?: readonly string[] | undefined;
  node?: "rfi" | "vs_open" | null | undefined;
  versus?: string | null | undefined;
  multiway?: boolean | null | undefined;
  /** @deprecated V2.4: não participa mais de nenhuma decisão de multiway. */
  activePlayers?: number | null | undefined;
  depthBB?: number | null | undefined;
  format?: string | null | undefined;
  tableSize?: string | null | undefined;
  decisionKey?: string | null | undefined;
};

export type PreflopDirectDecision = {
  kind: "decision";
  advice: string;
  actionCode: "FOLD" | "CALL" | "RAISE";
  baselineAction: ActionKey;
  engine: string;
  reason: string;
  chart: string;
  distribution: ActionDistribution;
  mixed: boolean;
  seed: string;
  roll: number;
};

export type PreflopInconsistent = {
  kind: "inconsistent";
  baselineAction: ActionKey;
  reason: string;
  chart: string;
};

export type PreflopDirectResult = PreflopDirectDecision | PreflopInconsistent | null;

const ORDER: ActionKey[] = ["fold", "call", "raise", "limp"];

export const seedRoll = (seed: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 10000) / 100;
};

export const pickFromDistribution = (
  distribution: ActionDistribution,
  roll: number,
): ActionKey | null => {
  let acc = 0;
  let last: ActionKey | null = null;
  for (const action of ORDER) {
    const freq = distribution[action];
    if (freq <= 0) continue;
    last = action;
    acc += freq;
    if (roll < acc) return action;
  }
  return last;
};

const LABEL: Record<"FOLD" | "CALL" | "RAISE", string> = {
  FOLD: "DESISTIR",
  CALL: "PAGAR",
  RAISE: "AUMENTAR",
};

const resolveNode = (input: PreflopDirectInput): { node: string; versus: string | null } => {
  if (input.node === "rfi" || input.node === "vs_open")
    return { node: input.node, versus: input.versus ?? null };
  const legacy = classifyPreflopNode(input.actionHistory ?? []);
  return { node: legacy.node, versus: legacy.versus };
};

const depthIsDirect = (depth: number | null | undefined): boolean =>
  typeof depth === "number" && Number.isFinite(depth) && depth >= 90 && depth <= 110;

export const preflopBaselineDecision = (input: PreflopDirectInput): PreflopDirectResult => {
  if (input.board.length !== 0) return null;
  if ((input.format ?? "cash") !== "cash") return null;
  if ((input.tableSize ?? "6max") !== "6max") return null;
  if (input.heroCards.length !== 2) return null;

  const legal = normalizeActions(input.legalActions);
  if (!legal.length) return null;

  const classified = resolveNode(input);
  if (classified.node !== "rfi" && classified.node !== "vs_open") return null;
  if (!depthIsDirect(input.depthBB)) return null;

  const verdict = lookupPreflop({
    heroCards: input.heroCards,
    heroPosition: input.heroPosition ?? null,
    node: classified.node,
    versus: classified.versus,
    multiway: input.multiway === true,
    depthBB: input.depthBB ?? null,
  });

  if (verdict.source !== "baseline" || verdict.confidence !== "alta") return null;
  const distribution = verdict.distribution;
  if (!distribution) return null;

  const seed = input.decisionKey ?? "";
  const roll = seedRoll(seed);
  const chosen = pickFromDistribution(distribution, roll);
  if (!chosen) return null;

  const position = normalizePosition(input.heroPosition ?? null);
  let code: "FOLD" | "CALL" | "RAISE" | null = null;
  if (chosen === "fold") code = "FOLD";
  else if (chosen === "call") code = "CALL";
  else if (chosen === "raise") code = "RAISE";
  else if (chosen === "limp") code = classified.node === "rfi" && position === "SB" ? "CALL" : null;

  if (!code)
    return {
      kind: "inconsistent",
      baselineAction: chosen,
      chart: verdict.chart,
      reason:
        "A baseline indica LIMP, mas este node não é o SB com pote unopened: a conversão silenciosa em PAGAR não seria semanticamente a mesma jogada.",
    };

  if (!legal.includes(code))
    return {
      kind: "inconsistent",
      baselineAction: chosen,
      chart: verdict.chart,
      reason: `A baseline indica ${chosen.toUpperCase()}, mas esse botão não está entre os confirmados (${legal.join(", ")}). Estado a revalidar; nada é substituído por outra jogada.`,
    };

  const freqs = ORDER.filter((a) => distribution[a] > 0)
    .map((a) => `${a.toUpperCase()} ${distribution[a]}%`)
    .join(" / ");
  const mixText = verdict.mixed
    ? ` Mix da baseline: ${freqs} (frequências SIMPLIFICADAS da fonte, não probabilidade de acerto; a frequência exata do solver é desconhecida). Escolha determinística e estável para este estado.`
    : "";

  return {
    kind: "decision",
    advice: LABEL[code],
    actionCode: code,
    baselineAction: chosen,
    engine: `PREFLOP V1 · BASELINE DIRETA · ${verdict.chart}`,
    reason: `${verdict.note}${mixText}`,
    chart: verdict.chart,
    distribution,
    mixed: !!verdict.mixed,
    seed,
    roll,
  };
};

export type PreflopFallbackCause =
  | "none"
  | "not-preflop"
  | "format-table-size"
  | "hero-cards-missing"
  | "position-missing"
  | "node-unknown"
  | "unsupported-node"
  | "multiway"
  | "depth-missing"
  | "depth-out-of-range"
  | "chart-source-not-baseline"
  | "low-confidence"
  | "legal-action-inconsistent";

export const BASELINE_DEPTH_MIN = 90;
export const BASELINE_DEPTH_MAX = 110;

export const depthInBaselineWindow = (depth: number | null | undefined): boolean =>
  depth == null || (depth >= BASELINE_DEPTH_MIN && depth <= BASELINE_DEPTH_MAX);

const CAUSE_TEXT: Record<PreflopFallbackCause, string> = {
  none: "cobertura direta",
  "not-preflop": "não é pré-flop",
  "format-table-size": "fora do escopo cash 6-max",
  "hero-cards-missing": "cartas do herói não confirmadas",
  "position-missing": "posição não confirmada",
  "node-unknown": "node não identificado",
  "unsupported-node": "node não coberto",
  multiway: "multiway",
  "depth-missing": "stack efetivo ainda não lido",
  "depth-out-of-range": "stack fora da faixa",
  "chart-source-not-baseline": "spot fora da baseline auditada",
  "low-confidence": "confiança reduzida da baseline",
  "legal-action-inconsistent": "botões inconsistentes com a baseline",
};

export const preflopFallbackCauseText = (cause: PreflopFallbackCause): string => CAUSE_TEXT[cause];

export const preflopFallbackCause = (input: PreflopDirectInput): PreflopFallbackCause => {
  if (input.board.length !== 0) return "not-preflop";
  if ((input.format ?? "cash") !== "cash" || (input.tableSize ?? "6max") !== "6max")
    return "format-table-size";
  if (input.heroCards.length !== 2) return "hero-cards-missing";
  if (!normalizePosition(input.heroPosition ?? null)) return "position-missing";

  const classified = resolveNode(input);
  if (classified.node === "unknown") return "node-unknown";
  if (classified.node !== "rfi" && classified.node !== "vs_open") return "unsupported-node";
  if (input.multiway === true) return "multiway";
  if (input.depthBB == null) return "depth-missing";
  if (!depthInBaselineWindow(input.depthBB)) return "depth-out-of-range";

  const verdict = lookupPreflop({
    heroCards: input.heroCards,
    heroPosition: input.heroPosition ?? null,
    node: classified.node,
    versus: classified.versus,
    multiway: false,
    depthBB: input.depthBB ?? null,
  });
  if (verdict.source !== "baseline") return "chart-source-not-baseline";
  if (verdict.confidence !== "alta" || !verdict.distribution) return "low-confidence";

  const result = preflopBaselineDecision(input);
  if (result?.kind === "inconsistent") return "legal-action-inconsistent";
  if (result?.kind === "decision") return "none";
  return "chart-source-not-baseline";
};
