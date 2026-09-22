/**
 * DECISÃO PÓS-FLOP V4 — policy data-driven na frente, heurística como FALLBACK.
 *
 * Fluxo obrigatório:
 *   ESTADO CONFIRMADO -> MATEMÁTICA -> POLICY -> LEGAL ACTION MASK -> DECISÃO.
 *
 * A policy escolhe apenas a AÇÃO. Street, cartas, pote, preço, legalidade, matemática e
 * all-in continuam vindo do motor determinístico. Sizing continua determinístico/heurístico.
 */
import type { PostflopAnalysis } from "./postflop";
import { mainDecision, type MainAction, type MainDecision } from "./postflop-decision";
import { runPolicy, type PolicyAction } from "./postflop-policy";

/** Diferença de probabilidade abaixo da qual o nó é tratado como genuinamente misto. */
const MIXED_PP = 0.1;

const VERB: Record<PolicyAction, MainAction> = {
  CHECK: "PASSAR",
  BET: "APOSTAR",
  CALL: "PAGAR",
  FOLD: "DESISTIR",
  RAISE: "AUMENTAR",
};

/** Sizing permanece determinístico: reaproveita a heurística quando ela também aposta/aumenta. */
const sizingFor = (action: MainAction, heuristic: MainDecision): number | null => {
  if (action !== "APOSTAR") return null;
  if (heuristic.sizingPct && (heuristic.action === "APOSTAR" || heuristic.label.includes("APOSTAR")))
    return heuristic.sizingPct;
  return 33;
};

const labelOf = (action: MainAction, sizingPct: number | null) =>
  action === "APOSTAR" && sizingPct ? `APOSTAR ${sizingPct}%` : action;

export type PolicyDecision = MainDecision & {
  /** De onde veio a ação: policy treinada ou fallback heurístico. */
  engine: "POLICY V4" | "HEURÍSTICA (FALLBACK)";
  policyProbabilities: Record<PolicyAction, number> | null;
};

export const policyDecision = (a: PostflopAnalysis): PolicyDecision => {
  const heuristic = mainDecision(a);

  // Estado insuficiente: a policy não é chamada; o motor determinístico manda.
  if (a.street === "analisando" || !a.strength || !a.legalActions.length)
    return { ...heuristic, engine: "HEURÍSTICA (FALLBACK)", policyProbabilities: null };

  const p = runPolicy(a);

  const pct = (x: number) => `${Math.round(x * 100)}%`;

  // Dentro da distribuição, a Policy V4 é a autoridade sempre que existe uma
  // ação legal. O suporte informa confiança/mix; não troca a inteligência
  // treinada por uma regra heurística silenciosamente.
  if (p.outOfDistribution || !p.action)
    return {
      ...heuristic,
      engine: "HEURÍSTICA (FALLBACK)",
      confidence: p.outOfDistribution ? "baixa" : heuristic.confidence,
      reason: p.outOfDistribution
        ? `${heuristic.reason} ${p.reason}`.trim()
        : `${heuristic.reason} Nenhuma ação legal dentro da policy.`.trim(),
      policyProbabilities: p.probabilities,
    };

  // A segunda ação também passa pela MÁSCARA LEGAL: nunca sugerir botão inexistente.
  const second = p.allowed.find((r) => r.action !== p.action && VERB[r.action]);
  const mixed = second && p.probability - second.probability < MIXED_PP;

  const action = VERB[p.action];
  const sizingPct = sizingFor(action, heuristic);
  const secondAction = second ? VERB[second.action] : null;

  if (mixed && secondAction)
    return {
      action: "ESTRATÉGIA MISTA",
      sizingPct,
      label: `ESTRATÉGIA MISTA: ${labelOf(action, sizingPct)} / ${secondAction}`,
      confidence: "baixa",
      source: "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL",
      reason: `Nó de indiferença: a policy externa distribui ${labelOf(action, sizingPct)} ${pct(p.probability)} e ${secondAction} ${pct(second!.probability)}. A ordem não indica prioridade.`,
      alternative: heuristic.alternative,
      engine: "POLICY V4",
      policyProbabilities: p.probabilities,
    };

  return {
    action,
    sizingPct,
    label: labelOf(action, sizingPct),
    confidence: p.confidence,
    source: "MATEMÁTICA + APROXIMAÇÃO PROFISSIONAL",
    reason: `${p.reason} Ação com ${pct(p.probability)} de suporte na policy; matemática e legalidade continuam vindo do motor determinístico.`,
    alternative: secondAction ? `${secondAction} (${pct(second!.probability)})` : heuristic.alternative,
    engine: "POLICY V4",
    policyProbabilities: p.probabilities,
  };
};