import { describe, expect, test } from "bun:test";
import { analyzePostflop } from "./postflop.ts";
import { FEATURE_NAMES, policyFeatures } from "./postflop-policy-features.ts";
import { policyFeatureParity, policyMeta, runPolicy } from "./postflop-policy.ts";
import { policyDecision } from "./postflop-policy-decision.ts";
import { decisionIsLegal } from "./postflop-decision.ts";

const spot = (over = {}) =>
  analyzePostflop({
    heroCards: ["Ah", "Qd"],
    board: ["Ks", "7h", "2d"],
    pot: "20",
    toCall: null,
    legalActions: ["CHECK", "BET"],
    heroPosition: "IP",
    heroStack: "100",
    effectiveStack: "100",
    blinds: "0.5/1",
    activePlayers: 2,
    actionHistory: ["FLOP", "OOP_CHECK"],
    potType: "SRP",
    heroInPosition: true,
    heroIsPreflopAggressor: true,
    ...over,
  });

describe("policy V4 — artefato e features", () => {
  test("paridade de features entre artefato e produção", () => {
    expect(policyFeatureParity()).toBe(true);
    expect(FEATURE_NAMES.length).toBe(74);
  });

  test("metadados versionados e com hash", () => {
    const m = policyMeta();
    expect(m.version).toBe("postflop-policy-v4");
    expect(m.nFeatures).toBe(FEATURE_NAMES.length);
    expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.nIterations).toBeGreaterThan(0);
  });

  test("features são determinísticas para o mesmo estado", () => {
    const a = spot();
    expect(policyFeatures(a)).toEqual(policyFeatures(a));
  });

  test("probabilidades somam 1", () => {
    const p = runPolicy(spot());
    const sum = Object.values(p.probabilities).reduce((x, y) => x + y, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });
});

describe("policy V4 — máscara de ações legais", () => {
  test("só escolhe ação disponível quando o herói enfrenta aposta", () => {
    const p = runPolicy(spot({ toCall: "10", legalActions: ["FOLD", "CALL", "RAISE"], pot: "30" }));
    expect(["CALL", "FOLD", "RAISE"]).toContain(p.action);
  });

  test("não aposta quando só existe passar/pagar", () => {
    const p = runPolicy(spot({ toCall: "6", legalActions: ["FOLD", "CALL"], pot: "26" }));
    expect(["CALL", "FOLD"]).toContain(p.action);
  });

  test("decisão final é sempre legal", () => {
    for (const la of [
      ["CHECK", "BET"],
      ["FOLD", "CALL"],
      ["FOLD", "CALL", "RAISE"],
    ]) {
      const a = spot({
        legalActions: la,
        toCall: la.includes("CALL") ? "8" : null,
        pot: la.includes("CALL") ? "28" : "20",
      });
      const d = policyDecision(a);
      expect(decisionIsLegal(d, la)).toBe(true);
    }
  });
});

describe("policy V4 — fallback e soberania do motor determinístico", () => {
  test("multiway não é autoridade da policy", () => {
    const d = policyDecision(spot({ activePlayers: 3 }));
    expect(d.engine).toBe("HEURÍSTICA (FALLBACK)");
    expect(d.confidence).toBe("baixa");
  });

  test("estado insuficiente devolve ANALISANDO pelo motor determinístico", () => {
    const d = policyDecision(spot({ board: ["Ks", "7h"], legalActions: [] }));
    expect(d.action).toBe("ANALISANDO");
    expect(d.engine).toBe("HEURÍSTICA (FALLBACK)");
  });

  test("policy não inventa all-in", () => {
    const d = policyDecision(spot({ toCall: "10", legalActions: ["FOLD", "CALL", "RAISE"], pot: "30" }));
    expect(d.action).not.toBe("ALL-IN");
  });

  test("street e cartas continuam vindo do motor", () => {
    const a = spot({ board: ["Ks", "7h", "2d", "Jc", "3s"] });
    expect(a.street).toBe("river");
    expect(a.cards.board.length).toBe(5);
    expect(policyDecision(a).action).not.toBe("ANALISANDO");
  });
});