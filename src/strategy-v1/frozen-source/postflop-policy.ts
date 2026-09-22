/**
 * POLICY PÓS-FLOP V4 — camada estratégica orientada a dados.
 *
 * Executa o artefato treinado (gradient boosting, PokerBench train split) sobre o
 * vetor de features do MOTOR DETERMINÍSTICO. A policy escolhe estratégia; ela NUNCA
 * decide estado, street, cartas, pote, preço, legalidade ou matemática.
 *
 * Fluxo: ESTADO CONFIRMADO -> MATEMÁTICA -> POLICY -> LEGAL ACTION MASK -> DECISÃO.
 */
import type { PostflopAnalysis } from "./postflop";
import { FEATURE_NAMES, policyFeatures } from "./postflop-policy-features";
import modelJson from "./postflop-policy-model.json";

export type PolicyAction = "CHECK" | "BET" | "CALL" | "FOLD" | "RAISE";

type Tree = {
  f: number[];
  t: number[];
  l: number[];
  r: number[];
  v: number[];
  leaf: number[];
  m: number[];
};

type Model = {
  version: string;
  dataset: string;
  seed: number;
  classes: PolicyAction[];
  features: string[];
  baseline: number[];
  trees: Tree[][];
  hash?: string;
};

const model = modelJson as unknown as Model;

/** O artefato só é válido se as features de produção baterem exatamente com as do treino. */
export const policyFeatureParity = (): boolean =>
  model.features.length === FEATURE_NAMES.length && model.features.every((n, i) => n === FEATURE_NAMES[i]);

const treeValue = (tree: Tree, x: number[]): number => {
  let i = 0;
  for (let guard = 0; guard < 512; guard++) {
    if (tree.leaf[i]) return tree.v[i]!;
    const raw = x[tree.f[i]!];
    const goLeft = raw == null || Number.isNaN(raw) ? tree.m[i] === 1 : raw <= tree.t[i]!;
    i = goLeft ? tree.l[i]! : tree.r[i]!;
  }
  return tree.v[i] ?? 0;
};

/** Probabilidades brutas por ação, sem máscara de legalidade. */
export const policyProbabilities = (x: number[]): Record<PolicyAction, number> => {
  const k = model.classes.length;
  const raw = new Array<number>(k);
  for (let c = 0; c < k; c++) raw[c] = model.baseline[c] ?? 0;
  for (const iter of model.trees) for (let c = 0; c < k; c++) raw[c]! += treeValue(iter[c]!, x);
  const max = Math.max(...raw);
  let sum = 0;
  const exp = raw.map((v) => {
    const e = Math.exp(v - max);
    sum += e;
    return e;
  });
  const out = {} as Record<PolicyAction, number>;
  model.classes.forEach((c, i) => {
    out[c] = exp[i]! / sum;
  });
  return out;
};

export type PolicyResult = {
  /** Ação escolhida já dentro do conjunto legal, ou null quando nenhuma ação é legal. */
  action: PolicyAction | null;
  probability: number;
  /** Probabilidade da melhor ação antes da máscara (diagnóstico de out-of-distribution). */
  rawTop: number;
  rawAction: PolicyAction | null;
  masked: boolean;
  probabilities: Record<PolicyAction, number>;
  ranked: { action: PolicyAction; probability: number }[];
  /** Mesmo ranking, já filtrado pela máscara legal (única lista utilizável para decidir). */
  allowed: { action: PolicyAction; probability: number }[];
  confidence: "alta" | "media" | "baixa";
  /** true quando a policy não deve ser autoridade (multiway, features ausentes, OOD). */
  outOfDistribution: boolean;
  reason: string;
};

/** Buckets calibrados no VALIDATION set (nunca no test): 0,85+ = 96,9%; 0,70+ = 84,7%; abaixo disso <70%. */
const bucket = (p: number): PolicyResult["confidence"] => (p >= 0.85 ? "alta" : p >= 0.7 ? "media" : "baixa");

const legalOf = (a: PostflopAnalysis): Set<PolicyAction> => {
  const s = new Set<PolicyAction>();
  const la = a.legalActions ?? [];
  if (la.includes("CHECK")) s.add("CHECK");
  if (la.includes("BET")) s.add("BET");
  if (la.includes("CALL")) s.add("CALL");
  if (la.includes("FOLD")) s.add("FOLD");
  if (la.includes("RAISE")) s.add("RAISE");
  // Este dataset (e várias mesas) rotula a aposta de abertura como RAISE; sem pagamento
  // pendente, RAISE e BET são o mesmo botão.
  if (s.has("RAISE") && !s.has("CALL") && s.has("CHECK")) {
    s.delete("RAISE");
    s.add("BET");
  }
  return s;
};

export const runPolicy = (a: PostflopAnalysis): PolicyResult => {
  const probabilities = policyProbabilities(policyFeatures(a));
  const ranked = (Object.keys(probabilities) as PolicyAction[])
    .map((action) => ({ action, probability: probabilities[action] }))
    .sort((x, y) => y.probability - x.probability);
  const legal = legalOf(a);
  const allowed = ranked.filter((r) => legal.has(r.action));
  const top = allowed[0] ?? null;
  const rawTop = ranked[0]!;
  // Só o ESTADO NUCLEAR bloqueia a policy. Posição, histórico, stack efetivo e número de
  // jogadores são FEATURES do modelo (com tratamento nativo de ausente), não pré-requisitos:
  // exigi-los derrubava toda decisão para o fallback heurístico.
  const coreMissing =
    a.inconsistentBoard || a.street === "analisando" || !a.strength || a.math.potChips == null || !legal.size;
  const ood = a.range.multiway === true || coreMissing || !policyFeatureParity();

  const reason = !policyFeatureParity()
    ? "Artefato da policy incompatível com as features de produção: usar fallback heurístico."
    : a.range.multiway
      ? "Pote multiway: a policy foi treinada em heads-up, então vale como aproximação, não como autoridade."
      : !legal.size
        ? "Nenhuma ação legal confirmada na tela."
        : coreMissing
          ? "Estado nuclear incompleto (street, mão ou pote não confirmados): usar fallback heurístico."
          : top && top.action !== rawTop.action
            ? `Ação preferida (${rawTop.action}) não está disponível; escolhida a melhor ação legal.`
            : "Decisão estratégica vinda da policy treinada em dados externos solver-derived.";

  return {
    action: top?.action ?? null,
    probability: top?.probability ?? 0,
    rawTop: rawTop.probability,
    rawAction: rawTop.action,
    masked: !!top && top.action !== rawTop.action,
    probabilities,
    ranked,
    allowed,
    confidence: ood ? "baixa" : bucket(top?.probability ?? 0),
    outOfDistribution: ood,
    reason,
  };
};

export const policyMeta = () => ({
  version: model.version,
  dataset: model.dataset,
  seed: model.seed,
  nFeatures: model.features.length,
  nIterations: model.trees.length,
  hash: model.hash ?? null,
});