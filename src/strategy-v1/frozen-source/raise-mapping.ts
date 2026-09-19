/**
 * MAPEAMENTO RAISE x ALL-IN V2.1 — semântica provada, nunca fórmula inventada.
 *
 * A Policy V4 permanece CONGELADA: ela devolve a classe genérica RAISE e nada
 * mais. O erro do replay real foi o produto tratar esse RAISE genérico como um
 * ALL-IN curto (stack 0,26 contra call 0,23) só porque sobravam poucas fichas.
 *
 * V2.1: a regra antiga (`sobra >= call`) NÃO provava que existe aumento mínimo
 * legal. O mínimo depende do último aumento completo da rodada. Agora ele é
 * DERIVADO do histórico canônico do ledger; sem informação suficiente a classe
 * é `unknown` e o estudo mostra AGUARDANDO ESTADO — nunca um all-in fabricado.
 */
import { bigBlindOf, normalizeActions, parseChips } from "./poker-state";

/** Rótulo visível quando falta informação para classificar o aumento. */
export const AWAITING_STATE = "AGUARDANDO ESTADO";

export type RaiseSizingClass =
  /** O aumento mínimo legal é PROVADO e cabe no stack lido. */
  | "confirmed"
  /** O mínimo é provado e não cabe: o único aumento seria all-in curto. */
  | "short-allin"
  /** Stack, preço, botões ou histórico insuficientes para provar o mínimo. */
  | "unknown";

const STREETS = new Set(["PREFLOP", "FLOP", "TURN", "RIVER"]);
const AGGRESSIVE = /\b(BET|RAISE|ALLIN|ALL-IN|APOSTA|AUMENT)\b/i;

/** Linhas canônicas da street corrente (depois do último marcador de street). */
export const currentStreetLines = (history: readonly string[]): string[] => {
  let start = -1;
  history.forEach((line, i) => {
    if (STREETS.has(line.trim().toUpperCase())) start = i;
  });
  return history.slice(start + 1);
};

export type MinRaiseProof = {
  /** Total que um aumento mínimo legal precisa atingir nesta rodada. */
  minRaiseTotal: number;
  /** Maior aposta/aumento já feito na rodada. */
  lastTotal: number;
  /** Incremento do último aumento completo. */
  increment: number;
} | null;

/**
 * Deriva o aumento mínimo legal do HISTÓRICO CANÔNICO. Devolve null quando a
 * prova não existe (sem ação agressiva legível, valor ilegível, etc.).
 * Nada é inventado: sem prova, não há mínimo.
 */
export type MinRaiseContext = {
  /** Street CONFIRMADA. No pré-flop o big blind já é uma aposta na mesa. */
  street?: string | null | undefined;
  /** Nível de blinds confirmado — obrigatório para provar o mínimo pré-flop. */
  blinds?: string | null | undefined;
};

const isPreflop = (street: string | null | undefined) =>
  (street ?? "").trim().toLowerCase() === "preflop";

export const minRaiseFromHistory = (
  history: readonly string[] | undefined,
  context: MinRaiseContext = {},
): MinRaiseProof => {
  // PRÉ-FLOP: o BIG BLIND é o primeiro "total" da rodada. Sem ele, um open de
  // 0.06 em 0.01/0.02 produzia incremento 0.06 e mínimo 0.12 — errado: o
  // incremento real é 0.04 e o mínimo é 0.10.
  const preflop = isPreflop(context.street);
  const bb = bigBlindOf(context.blinds);
  // Pré-flop sem blinds confirmados: o mínimo NÃO é provável. Não se inventa.
  if (preflop && bb === null) return null;
  // V2.2.1: o mínimo NUNCA diminui por causa de um ALL-IN curto. Seguimos
  // `currentBet` + `lastFullRaiseIncrement`: um aumento menor que o último
  // aumento completo move o preço, mas não redefine o incremento legal.
  let currentBet = preflop ? bb! : 0;
  let increment = 0;
  for (const line of currentStreetLines(history ?? [])) {
    const hit = AGGRESSIVE.exec(line);
    if (!hit) continue;
    // O valor é o que vem DEPOIS da palavra da ação. Pegar o primeiro número da
    // linha lia o NÚMERO DO ASSENTO ("S3 BET 0.23" virava 3) e fabricava um
    // mínimo inexistente.
    const after = line.slice(hit.index + hit[0].length);
    const amount = parseChips(after.trim() || null);
    // Ação agressiva sem valor legível impede a prova do mínimo.
    if (amount === null) return null;
    if (!(amount > currentBet)) continue; // não aumenta o preço: não prova nada
    const step = amount - currentBet;
    if (step >= increment) increment = step; // aumento completo redefine o mínimo
    currentBet = amount; // all-in curto move só o preço
  }
  if (!(increment > 0)) return null;
  return { minRaiseTotal: currentBet + increment, lastTotal: currentBet, increment };
};

export type RaiseSizingInput = {
  toCall: string | null | undefined;
  heroStack: string | null | undefined;
  effectiveStack: string | null | undefined;
  legalActions: readonly string[];
  /** Histórico canônico (ledger) da mão — única fonte do mínimo legal. */
  actionHistory?: readonly string[] | undefined;
  /** Street confirmada e blinds: sem eles o mínimo pré-flop não é provável. */
  street?: string | null | undefined;
  blinds?: string | null | undefined;
};

export const raiseSizingClass = (input: RaiseSizingInput): RaiseSizingClass => {
  const legal = normalizeActions([...input.legalActions]);
  if (!legal.includes("RAISE")) return "unknown";
  const stack = parseChips(input.heroStack) ?? parseChips(input.effectiveStack);
  const call = parseChips(input.toCall);
  // Sem stack ou sem preço confirmado não há como saber o que "AUMENTAR" significa.
  if (stack === null || call === null) return "unknown";
  const proof = minRaiseFromHistory(input.actionHistory, {
    street: input.street,
    blinds: input.blinds,
  });
  // Sem prova do mínimo legal não se classifica: AGUARDANDO ESTADO.
  if (!proof) return "unknown";
  return stack >= proof.minRaiseTotal ? "confirmed" : "short-allin";
};


/**
 * RAISE genérico só pode virar decisão visível quando o sizing está PROVADO.
 * ALL-IN explícito continua permitido: ele é uma classe própria, lida nos botões.
 */
export const genericRaiseIsAllowed = (input: RaiseSizingInput): boolean =>
  raiseSizingClass(input) === "confirmed";