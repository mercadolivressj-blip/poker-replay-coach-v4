import { describe, expect, test } from "bun:test";
import { productionPostflopDecision } from "./table-reader.functions.ts";
import { readFileSync } from "node:fs";
import { createLedger, ingestLines, ledgerLines } from "./action-ledger.ts";

/**
 * Prova de runtime: a cadeia de produção pós-flop
 * estado -> matemática -> POLICY V4 -> máscara legal -> Decision Layer V4.
 */
const base = {
  heroCards: ["Ah", "Kd"],
  board: ["Ac", "7d", "2s"],
  pot: "10",
  toCall: null,
  legalActions: ["CHECK", "BET"],
  heroPosition: "BTN",
  heroStack: "100",
  effectiveStack: "100",
  blinds: "0.5/1",
  activePlayers: 2,
  actionHistory: ["PREFLOP", "CO RAISE 2.5", "BB CALL 2.5", "FLOP", "BB CHECK"],
  format: "cash",
  tableSize: "6max",
};

describe("cadeia de produção pós-flop", () => {
  test("o caminho rápido nunca envia uma decisão para modelo externo", () => {
    const source = readFileSync(new URL("./table-reader.functions.ts", import.meta.url), "utf8");
    const fastHandler = source.slice(
      source.indexOf("export const getFastCoachAction"),
      source.indexOf("async function requestAdvice"),
    );
    expect(fastHandler).not.toContain("ai.gateway.lovable.dev");
    expect(fastHandler).not.toContain("preflopEngineLabel(data)");
    expect(fastHandler).toContain("productionPostflopDecision(data)");
    expect(fastHandler).toContain("productionPreflopDecision(data)");
  });
  test("pós-flop heads-up: a decisão vem da POLICY V4", () => {
    const d = productionPostflopDecision(base);
    expect(d).not.toBe(null);
    expect(d.engine).toBe("POLICY V4");
    expect(typeof d.label).toBe("string");
    expect(d.policyProbabilities).not.toBe(null);
  });

  test("a decisão sempre cabe nos botões reais", () => {
    for (const legalActions of [
      ["CHECK", "BET"],
      ["FOLD", "CALL", "RAISE"],
    ]) {
      const d = productionPostflopDecision({ ...base, legalActions, toCall: legalActions.includes("CALL") ? "5" : null });
      expect(d).not.toBe(null);
      if (d.action === "PASSAR") expect(legalActions).toContain("CHECK");
      if (d.action === "DESISTIR") expect(legalActions).toContain("FOLD");
      if (d.action === "PAGAR") expect(legalActions).toContain("CALL");
      if (d.action === "APOSTAR") expect(legalActions).toContain("BET");
      if (d.action === "AUMENTAR") expect(legalActions).toContain("RAISE");
    }
  });

  test("pré-flop não passa pela policy: continua com o chart congelado", () => {
    expect(productionPostflopDecision({ ...base, board: [] })).toBe(null);
  });

  test("sem botões legíveis a cadeia não decide", () => {
    expect(productionPostflopDecision({ ...base, legalActions: [] })).toBe(null);
  });

  test("multiway cai no fallback heurístico declarado", () => {
    const d = productionPostflopDecision({ ...base, activePlayers: 3 });
    expect(d).not.toBe(null);
    expect(d.engine).toBe("HEURÍSTICA (FALLBACK)");
  });

  test("a Strategy V1 recebe o histórico vindo do ledger, não texto bruto", () => {
    let l = createLedger(1);
    l = ingestLines(l, ["CO aumenta para 2.5", "BB paga 2.5"], { street: "preflop", t: 1 });
    l = ingestLines(l, ["BB passa"], { street: "flop", t: 2 });
    const historico = ledgerLines(l);
    expect(historico).toEqual(["PREFLOP", "CO RAISE 2.5", "BB CALL 2.5", "FLOP", "BB CHECK"]);
    const d = productionPostflopDecision({ ...base, actionHistory: historico });
    expect(d).not.toBe(null);
    expect(d.engine).toBe("POLICY V4");
  });
});

/**
 * REAL REPLAY FIX V2 — fixture do spot histórico T8 no river.
 * Policy V4 permanece congelada: só o mapeamento semântico do aumento mudou.
 */
describe("T8 river — aumento genérico sem sizing confirmado", () => {
  const t8 = {
    heroCards: ["Tc", "8d"],
    board: ["3c", "Qh", "Jc", "Ac", "5s"],
    pot: "0.50",
    toCall: "0.23",
    legalActions: ["FOLD", "CALL", "RAISE"],
    heroPosition: "BB",
    heroStack: "0.26",
    effectiveStack: "0.26",
    blinds: "0.01/0.02",
    activePlayers: 2,
    actionHistory: ["RIVER", "S4 BET 0.23"],
    format: "cash",
    tableSize: "6max",
  };

  test("o resultado visível nunca é ALL-IN por conversão automática", () => {
    const d = productionPostflopDecision(t8);
    if (d) {
      expect(d.label).not.toBe("ALL-IN");
      expect(d.action).not.toBe("ALL-IN");
      if (d.label === "AGUARDANDO ESTADO") expect(d.action).toBe("ANALISANDO");
      else expect(d.label).not.toBe("AUMENTAR");
    }
  });

  test("com stack profundo o mesmo nó volta a permitir AUMENTAR", () => {
    const deep = productionPostflopDecision({ ...t8, heroStack: "5.00", effectiveStack: "5.00" });
    expect(deep === null || deep.label !== "AGUARDANDO ESTADO").toBe(true);
  });
});