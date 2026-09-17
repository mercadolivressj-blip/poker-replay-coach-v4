/**
 * RESOLVEDOR ÚNICO PRÉ-FLOP.
 */
import { baselineConsensusDecision, baselineTightestDecision, type BaselineConsensusDecision, type BaselineConsensusInput } from "./baseline-consensus";
import { legacyChartDecision } from "./legacy-chart-decision";
import { preflopBaselineDecision } from "./preflop-decision";

export type ResolvePreflopInput = BaselineConsensusInput & {
  heroPosition?: string | null;
  multiway?: boolean;
};

export const resolvePreflopDecision = (input: ResolvePreflopInput): BaselineConsensusDecision | null => {
  if (input.heroPosition && (input.node === "rfi" || input.node === "vs_open")) {
    const direct = preflopBaselineDecision({
      heroCards: input.heroCards,
      board: input.board,
      heroPosition: input.heroPosition,
      legalActions: input.legalActions,
      node: input.node,
      versus: input.versus ?? null,
      multiway: input.multiway === true,
      depthBB: input.depthBB ?? null,
      format: input.format ?? "cash",
      tableSize: input.tableSize ?? "6max",
      decisionKey: input.decisionKey ?? "",
    });
    if (direct?.kind === "decision")
      return { advice: direct.advice, actionCode: direct.actionCode, engine: direct.engine, reason: direct.reason, positions: [input.heroPosition] };
  }
  return baselineConsensusDecision(input) ?? baselineTightestDecision(input) ?? legacyChartDecision(input);
};
