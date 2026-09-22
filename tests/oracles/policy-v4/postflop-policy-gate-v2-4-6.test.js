/**
 * V2.4.6 — a POLICY V4 só pode cair para HEURÍSTICA (FALLBACK) quando o ESTADO NUCLEAR
 * (street, mão, pote, ações legais) está incompleto ou o pote é multiway.
 * Posição, histórico e número de jogadores são FEATURES do modelo, não pré-requisitos.
 */
import { describe, expect, test } from "bun:test";
import { analyzePostflop } from "./postflop.ts";
import { policyDecision } from "./postflop-policy-decision.ts";
import { runPolicy } from "./postflop-policy.ts";

const base = {
  heroCards: ["Ad", "7d"],
  board: ["2s", "Jd", "Qh", "Ac", "9d"],
  pot: "4,71",
  toCall: "2,57",
  legalActions: ["FOLD", "CALL", "RAISE"],
  heroStack: "48,82",
  blinds: "0,25/0,50",
};

describe("gate da policy", () => {
  test("sem posição, sem histórico e sem contagem de jogadores a policy continua sendo autoridade", () => {
    const a = analyzePostflop(base);
    expect(a.strategicConfidence).toBe("baixa");
    const d = policyDecision(a);
    expect(d.engine).toBe("POLICY V4");
    expect(d.policyProbabilities).not.toBeNull();
  });

  test("multiway continua fora da autoridade da policy", () => {
    const d = policyDecision(analyzePostflop({ ...base, activePlayers: 3 }));
    expect(d.engine).toBe("HEURÍSTICA (FALLBACK)");
  });

  test("sem ações legais confirmadas cai no fallback", () => {
    const d = policyDecision(analyzePostflop({ ...base, legalActions: [] }));
    expect(d.engine).toBe("HEURÍSTICA (FALLBACK)");
  });

  test("pote não confirmado cai no fallback", () => {
    const d = policyDecision(analyzePostflop({ ...base, pot: null }));
    expect(d.engine).toBe("HEURÍSTICA (FALLBACK)");
  });

  test("board inconsistente nunca vira decisão da policy", () => {
    const d = policyDecision(analyzePostflop({ ...base, board: ["2s", "2s"] }));
    expect(d.engine).toBe("HEURÍSTICA (FALLBACK)");
  });

  test("suporte baixo não substitui a Policy V4 por heurística", () => {
    const candidates = [
      { ...base, heroCards: ["2c", "3c"] },
      { ...base, heroCards: ["8h", "7h"], board: ["2s", "Jd", "Qh"] },
      { ...base, heroCards: ["Tc", "9c"], board: ["2s", "7d", "Qh", "4c"] },
    ];
    const lowSupport = candidates
      .map((input) => analyzePostflop(input))
      .find((analysis) => {
        const p = runPolicy(analysis);
        return !p.outOfDistribution && p.action !== null && p.probability < 0.45;
      });

    expect(lowSupport).toBeDefined();
    const d = policyDecision(lowSupport);
    expect(d.engine).toBe("POLICY V4");
    expect(d.policyProbabilities).not.toBeNull();
  });
});