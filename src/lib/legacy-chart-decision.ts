/**
 * CHART LEGADO COMO TERCEIRA AUTORIDADE PRÉ-FLOP (V2.4.8).
 */
import { bigBlindOf, normalizeActions, parseChips } from "./poker-state";
import { CHART_VERSION, handCode, legacyDefenseVerdict, legacyRfiHas, normalizePosition, type Position } from "./ranges-6max";
import { plausibleHeroPositions, plausibleVsOpenPairs, POSITION_ORDER, type BaselineConsensusDecision, type BaselineConsensusInput } from "./baseline-consensus";

export const LEGACY_ENGINE = `PREFLOP V1 · CHART LEGADO 6-MAX · ${CHART_VERSION}`;
const LABEL: Record<string, string> = { FOLD: "DESISTIR", CALL: "PAGAR", RAISE: "AUMENTAR", CHECK: "PASSAR" };
type Code = "FOLD" | "CALL" | "RAISE" | "CHECK";

const decide = (code: Code, legal: string[], reason: string, positions: string[]): BaselineConsensusDecision | null => {
  if (!legal.includes(code)) return null;
  return { advice: LABEL[code]!, actionCode: code as BaselineConsensusDecision["actionCode"], engine: LEGACY_ENGINE, reason, positions };
};
const heroIsBBOption = (legal: string[]): boolean => legal.includes("CHECK") && !legal.includes("CALL");

export const legacyChartDecision = (input: BaselineConsensusInput): BaselineConsensusDecision | null => {
  if (input.board.length !== 0) return null;
  const hand = handCode(input.heroCards); if (!hand) return null;
  const legal = normalizeActions([...input.legalActions]); if (!legal.length) return null;
  const bb = bigBlindOf(input.blinds ?? null); const pot = parseChips(input.pot ?? null); const toCall = parseChips(input.toCall ?? null);

  if (input.unopened) {
    const positions = plausibleHeroPositions({ legalActions: legal, toCall: input.toCall, pot: input.pot, blinds: input.blinds });
    const sorted = positions.map((p) => normalizePosition(p)).filter((p): p is Position => !!p).sort((a, b) => POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b));
    if (!sorted.length) return null;
    const hero = sorted[0]!;
    if (hero === "BB") return decide("CHECK", legal, `Pote não aberto e o herói é a BB: sem aposta para pagar, o chart ${CHART_VERSION} não abre mão da opção grátis.`, sorted);
    const open = legacyRfiHas(hand, hero);
    return decide(open ? "RAISE" : "FOLD", legal, `Fora da faixa validada da baseline, a leitura vem do chart ${CHART_VERSION}: ${hero} RFI com ${hand} ${open ? "está" : "não está"} na range de abertura.`, sorted) ?? decide("CHECK", legal, `Chart ${CHART_VERSION}: ${hand} fora da range de abertura de ${hero}; sem aposta para pagar, a opção grátis é mantida.`, sorted);
  }

  if (input.node === "vs_open") {
    const pairs = plausibleVsOpenPairs(input.versus ?? null).sort((a, b) => POSITION_ORDER.indexOf(a.hero) - POSITION_ORDER.indexOf(b.hero));
    for (const pair of pairs) {
      const hero = normalizePosition(pair.hero); const versus = normalizePosition(pair.versus);
      if (!hero || !versus) continue;
      const verdict = legacyDefenseVerdict(hand, hero, versus); if (!verdict) continue;
      const code: Code = verdict === "3-BET" ? "RAISE" : verdict === "PAGAR" ? "CALL" : "FOLD";
      const reason = `Spot fora da baseline congelada; decidido pelo chart ${CHART_VERSION}: ${hero} vs abertura de ${versus} com ${hand} = ${verdict}.`;
      const out = decide(code, legal, reason, [hero]) ?? (code === "FOLD" ? decide("CHECK", legal, reason, [hero]) : null);
      if (out) return out;
    }
  }

  if (heroIsBBOption(legal) && bb !== null && pot !== null && pot > bb * 1.6) {
    const verdict = legacyDefenseVerdict(hand, "BB", "UTG");
    if (verdict === "3-BET") return decide("RAISE", legal, `Pote limpado (fora da baseline congelada). Pelo chart ${CHART_VERSION}, ${hand} está na parte de aumento da defesa da BB: aumentar para isolar.`, ["BB"]);
    return decide("CHECK", legal, `Pote limpado (fora da baseline congelada). Pelo chart ${CHART_VERSION}, ${hand} não está na parte de aumento da defesa da BB: passar e ver o flop de graça.`, ["BB"]);
  }

  if (toCall !== null && toCall > 0 && bb !== null) {
    const verdict = legacyDefenseVerdict(hand, "BB", "UTG") ?? "DESISTIR";
    const cheap = toCall <= bb * 3;
    const code: Code = verdict === "3-BET" ? "RAISE" : verdict === "PAGAR" && cheap ? "CALL" : "FOLD";
    const reason = `Node pré-flop fora da baseline congelada; leitura conservadora do chart ${CHART_VERSION} (defesa da BB contra abertura adiantada) com ${hand} = ${verdict}${code === "FOLD" && verdict === "PAGAR" ? ", mas o preço está caro para esse node" : ""}.`;
    const out = decide(code, legal, reason, ["BB"]); if (out) return out;
  }

  const terminalReason = `Spot fora de todas as tabelas indexadas (${CHART_VERSION}): ${hand} não aparece em nenhuma faixa de continuação aplicável, então a leitura conservadora é a única honesta.`;
  return decide("CHECK", legal, terminalReason, []) ?? decide("FOLD", legal, terminalReason, []) ?? null;
};
