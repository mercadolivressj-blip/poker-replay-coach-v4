/**
 * Matemática determinística do coach.
 * Tudo que pode ser calculado é calculado aqui, em código, e enviado pronto para a IA.
 * A IA é proibida de recalcular ou contradizer estes números.
 */
import { parseChips, bigBlindOf } from "./poker-state";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Stack efetivo real: o menor entre o herói e o maior adversário relevante. */
export const effectiveStackChips = (
  heroStack: string | null | undefined,
  effectiveStack: string | null | undefined,
  villainStacks: (string | null | undefined)[] = [],
): number | null => {
  const explicit = parseChips(effectiveStack);
  const hero = parseChips(heroStack);
  const villains = villainStacks.map(parseChips).filter((n): n is number => !!n);
  if (explicit) return hero ? Math.min(explicit, hero) : explicit;
  if (!hero) return null;
  if (!villains.length) return hero;
  return Math.min(hero, Math.max(...villains));
};

/** SPR = stack efetivo / pote. Define se a mão é para empilhar ou controlar o pote. */
export const spr = (
  pot: string | null | undefined,
  effStackChips: number | null,
): { spr: number; regime: "baixo" | "medio" | "alto" } | null => {
  const p = parseChips(pot);
  if (!p || !effStackChips || effStackChips <= 0) return null;
  const value = round1(effStackChips / p);
  const regime = value <= 3 ? "baixo" : value <= 8 ? "medio" : "alto";
  return { spr: value, regime };
};

/** Equidade mínima para pagar: call / (pote + call). Mesma conta do breakeven de bluff catch. */
export const requiredEquity = (pot: number, call: number): number | null => {
  if (!(pot > 0) || !(call > 0)) return null;
  return Math.round((call / (pot + call)) * 1000) / 10;
};

/**
 * Bluff catch: qual fração do range que apostou precisa ser blefe para o call empatar.
 * É exatamente a equidade necessária — mas expressa como pergunta de range, não de mão.
 */
export const bluffCatchBreakeven = (
  pot: string | null | undefined,
  toCall: string | null | undefined,
): { needBluffPct: number; pot: number; call: number } | null => {
  const p = parseChips(pot);
  const c = parseChips(toCall);
  if (!p || !c) return null;
  const needBluffPct = Math.round((c / (p + c)) * 1000) / 10;
  return { needBluffPct, pot: p, call: c };
};

/** Fold equity necessária para um blefe/shove empatar: risco / (risco + pote). */
export const foldEquityNeeded = (
  pot: string | null | undefined,
  risk: string | null | undefined,
): number | null => {
  const p = parseChips(pot);
  const r = parseChips(risk);
  if (!p || !r) return null;
  return Math.round((r / (p + r)) * 1000) / 10;
};

/** MDF = pote / (pote + aposta): referência auxiliar, nunca regra cega. */
export const minDefenseFrequency = (
  pot: string | null | undefined,
  bet: string | null | undefined,
): number | null => {
  const p = parseChips(pot);
  const b = parseChips(bet);
  if (!p || !b) return null;
  return Math.round((p / (p + b)) * 1000) / 10;
};

/**
 * Equidade aproximada de um draw a partir de outs LIMPOS.
 * street = "flop" (2 cartas por vir) ou "turn" (1 carta).
 * No river não existe draw: retorna null de propósito.
 */
export const outsEquity = (
  cleanOuts: number,
  street: "flop" | "turn" | "river" | string,
): { equity: number; cardsToCome: number } | null => {
  if (!Number.isFinite(cleanOuts) || cleanOuts <= 0) return null;
  if (street === "river") return null;
  const cardsToCome = street === "flop" ? 2 : 1;
  const unseen = street === "flop" ? 47 : 46;
  const equity =
    cardsToCome === 1
      ? round1((cleanOuts / unseen) * 100)
      : round1((1 - ((47 - cleanOuts) / 47) * ((46 - cleanOuts) / 46)) * 100);
  return { equity, cardsToCome };
};

/** Outs contaminados valem menos: desconto explícito, nunca escondido. */
export const discountOuts = (rawOuts: number, contaminated: number): number =>
  Math.max(0, Math.round((rawOuts - contaminated * 0.5) * 10) / 10);

/** Tamanho de aumento mínimo/padrão a partir da aposta do vilão. */
export const raiseSizing = (
  pot: string | null | undefined,
  villainBet: string | null | undefined,
): { pot: number; bet: number; minRaiseTo: number; valueRaiseTo: number } | null => {
  const p = parseChips(pot);
  const b = parseChips(villainBet);
  if (!p || !b) return null;
  const minRaiseTo = b * 2;
  const valueRaiseTo = Math.round(b * 3);
  return { pot: p, bet: b, minRaiseTo, valueRaiseTo };
};

/** Profundidade em BB do stack EFETIVO — base de toda decisão. */
export const effectiveDepthBB = (
  effStackChips: number | null,
  blinds: string | null | undefined,
): number | null => {
  const bb = bigBlindOf(blinds);
  if (!effStackChips || !bb) return null;
  return round1(effStackChips / bb);
};