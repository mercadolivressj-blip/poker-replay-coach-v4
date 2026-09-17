/**
 * Ranges estruturados e VERSIONADOS de cash 6-max (100bb, ambiente com rake).
 */
import {
  BASELINE_META,
  lookupBaseline,
  presentBaseline,
  type ActionDistribution,
} from "./ranges-100z";

export const CHART_VERSION = "cash6max-100bb-v1";
export const LEGACY_CHART_VERSION = CHART_VERSION;

const ORDER = "23456789TJQKA";
const idx = (r: string) => ORDER.indexOf(r.toUpperCase());

export type Position = "UTG" | "HJ" | "CO" | "BTN" | "SB" | "BB";
const POSITIONS: Position[] = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];

export const normalizePosition = (value: string | null | undefined): Position | null => {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  const alias: Record<string, Position> = {
    UTG: "UTG", EP: "UTG", MP: "HJ", HJ: "HJ", LJ: "UTG", CO: "CO",
    BTN: "BTN", BU: "BTN", BUTTON: "BTN", SB: "SB", BB: "BB",
  };
  return alias[v] ?? (POSITIONS.includes(v as Position) ? (v as Position) : null);
};

export const handCode = (cards: string[]): string | null => {
  if (cards.length !== 2) return null;
  const a = cards[0]!.trim();
  const b = cards[1]!.trim();
  const r1 = a[0]?.toUpperCase() ?? "";
  const r2 = b[0]?.toUpperCase() ?? "";
  if (idx(r1) < 0 || idx(r2) < 0) return null;
  const suited = a.slice(1).toLowerCase() === b.slice(1).toLowerCase() && a.length > 1;
  if (r1 === r2) return `${r1}${r1}`;
  const hi = idx(r1) > idx(r2) ? r1 : r2;
  const lo = idx(r1) > idx(r2) ? r2 : r1;
  return `${hi}${lo}${suited ? "s" : "o"}`;
};

const expand = (token: string): string[] => {
  const t = token.trim();
  const plus = t.endsWith("+");
  const body = plus ? t.slice(0, -1) : t;
  const hi = body[0]!.toUpperCase();
  const lo = body[1]!.toUpperCase();
  const suit = body.slice(2).toLowerCase();
  if (hi === lo) {
    const out: string[] = [];
    for (let i = idx(hi); i < ORDER.length; i++) { out.push(`${ORDER[i]}${ORDER[i]}`); if (!plus) break; }
    return out;
  }
  const out: string[] = [];
  for (let i = idx(lo); i < idx(hi); i++) { out.push(`${hi}${ORDER[i]}${suit}`); if (!plus) break; }
  return out;
};

const range = (tokens: string) => new Set(tokens.split(",").map((t) => t.trim()).filter(Boolean).flatMap(expand));

const RFI: Record<Position, Set<string>> = {
  UTG: range("22+, A2s+, KTs+, QTs+, JTs, T9s, 98s, 87s, 76s, AJo+, KQo"),
  HJ: range("22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, ATo+, KJo+, QJo"),
  CO: range("22+, A2s+, K7s+, Q8s+, J8s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A9o+, KTo+, QTo+, JTo"),
  BTN: range("22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K7o+, Q8o+, J8o+, T8o+, 97o+, 87o"),
  SB: range("22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o"),
  BB: new Set<string>(),
};

type Defense = { threebet: Set<string>; call: Set<string> };
const VS_OPEN: Partial<Record<string, Defense>> = {
  "BB:UTG": { threebet: range("JJ+, AKs, AQs, AKo, A5s, A4s, KJs"), call: range("22+, A2s+, K9s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, AJo+, KQo, QJo, JTo") },
  "BB:CO": { threebet: range("TT+, AJs+, AKo, AQo, A5s, A4s, A3s, KJs+, QJs, T9s, 76s"), call: range("22+, A2s+, K5s+, Q7s+, J7s+, T7s+, 96s+, 85s+, 74s+, 64s+, 53s+, ATo+, KTo+, QTo+, JTo, T9o") },
  "BB:BTN": { threebet: range("99+, ATs+, AQo+, A5s, A4s, A3s, A2s, KTs+, QTs+, JTs, T9s, 98s, 87s, 76s, 65s"), call: range("22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 95s+, 84s+, 74s+, 63s+, 53s+, A2o+, K7o+, Q8o+, J8o+, T8o+, 97o+, 87o") },
  "BB:SB": { threebet: range("88+, ATs+, KTs+, QTs+, JTs, T9s, 98s, 87s, 76s, 65s, A9o+, KJo+, QJo, A5s, A4s"), call: range("22+, A2s+, K2s+, Q2s+, J4s+, T5s+, 95s+, 84s+, 73s+, 63s+, 53s+, 43s, A2o+, K5o+, Q7o+, J7o+, T7o+, 96o+, 86o+, 75o+, 65o") },
  "SB:BTN": { threebet: range("77+, A9s+, KTs+, QTs+, JTs, T9s, 98s, 87s, 76s, A5s, A4s, A3s, ATo+, KQo"), call: range("55+, AJs+, KJs+, QJs") },
  "SB:CO": { threebet: range("88+, ATs+, KJs+, QJs, JTs, T9s, 98s, 76s, A5s, A4s, AQo+"), call: range("66+, AJs+, KQs") },
  "SB:UTG": { threebet: range("TT+, AQs+, AKo, A5s, KQs"), call: range("77+, AJs+, KQs, QJs, JTs") },
  "BTN:UTG": { threebet: range("QQ+, AKs, AQs, AKo, A5s, KQs"), call: range("22+, AJs+, KTs+, QTs+, JTs, T9s, 98s, 87s, 76s, AQo+, KQo") },
  "BTN:CO": { threebet: range("TT+, AJs+, AQo+, KTs+, QTs+, JTs, T9s, 87s, 76s, A5s, A4s"), call: range("22+, ATs+, KTs+, QTs+, JTs, T9s, 98s, 87s, 76s, 65s, AJo+, KQo, QJo") },
  "CO:UTG": { threebet: range("QQ+, AKs, AQs, AKo, A5s"), call: range("22+, AJs+, KJs+, QJs, JTs, T9s, 98s, AQo+") },
};

export const legacyRfiHas = (hand: string, position: Position): boolean => RFI[position]?.has(hand) ?? false;
export const legacyDefenseVerdict = (hand: string, hero: Position, versus: Position): "3-BET" | "PAGAR" | "DESISTIR" | null => {
  const chart = VS_OPEN[`${hero}:${versus}`];
  if (!chart) return null;
  if (chart.threebet.has(hand)) return "3-BET";
  if (chart.call.has(hand)) return "PAGAR";
  return "DESISTIR";
};
export const legacyDefensePairs = (): string[] => Object.keys(VS_OPEN);

export type PreflopNode = "rfi" | "vs_open" | "unknown";
export type RangeVerdict = {
  chart: string; node: PreflopNode; hand: string | null; position: Position | null; versus: Position | null;
  reference: "ABRIR" | "3-BET" | "PAGAR" | "LIMP" | "DESISTIR" | "ESTRATÉGIA MISTA" | null;
  source: "chart" | "baseline" | "aproximacao"; confidence: "alta" | "media" | "baixa"; note: string;
  distribution?: ActionDistribution; mixed?: boolean;
};

const approx = (note: string, partial: Partial<RangeVerdict> = {}): RangeVerdict => ({ chart: CHART_VERSION, node: "unknown", hand: null, position: null, versus: null, reference: null, source: "aproximacao", confidence: "baixa", note, ...partial });

export const lookupPreflop = (input: { heroCards: string[]; heroPosition: string | null | undefined; node: PreflopNode; versus?: string | null; multiway?: boolean; depthBB?: number | null; preferLegacy?: boolean; }): RangeVerdict => {
  const hand = handCode(input.heroCards); const pos = normalizePosition(input.heroPosition); const vs = normalizePosition(input.versus ?? null); const deepOk = input.depthBB == null || (input.depthBB >= 50 && input.depthBB <= 200);
  if (!hand) return approx("Mão ilegível: nenhum chart aplicável.");
  if (!pos) return approx("Posição do herói não lida: chart não aplicável.", { hand });
  if (!deepOk) return approx(`Chart é de 100bb; stack efetivo ~${input.depthBB}bb foge da faixa validada — trate como aproximação.`, { hand, position: pos });
  if (input.multiway) return approx("Pote multiway: o chart heads-up não vale; aperte value e reduza blefes.", { hand, position: pos });

  if (!input.preferLegacy && (input.node === "rfi" || input.node === "vs_open")) {
    const entry = input.node === "rfi" ? lookupBaseline({ hand, position: pos, node: "rfi" }) : vs ? lookupBaseline({ hand, position: pos, versus: vs, node: "vs_open" }) : null;
    if (entry) {
      const view = presentBaseline(entry); const exact = input.depthBB == null || (input.depthBB >= 90 && input.depthBB <= 110);
      const note = exact ? `${BASELINE_META.stake}, ${BASELINE_META.effectiveStackBB}bb, rake ${BASELINE_META.rake} cap ${BASELINE_META.rakeCapBB}bb. ${view.text}` : `Baseline validada em ${BASELINE_META.effectiveStackBB}bb aplicada a um stack efetivo ~${input.depthBB}bb: baseline 100bb usada como APROXIMAÇÃO, confiança estratégica reduzida; não existe range específica validada para esse stack. ${view.text}`;
      return { chart: BASELINE_META.version, node: input.node, hand, position: pos, versus: entry.versus, reference: view.label, source: "baseline", confidence: exact ? "alta" : "media", note, distribution: entry.distribution, mixed: entry.mixed };
    }
  }

  if (input.node === "rfi") {
    if (pos === "BB") return approx("BB não abre: node inválido para RFI.", { hand, position: pos });
    const open = RFI[pos].has(hand);
    return { chart: CHART_VERSION, node: "rfi", hand, position: pos, versus: null, reference: open ? "ABRIR" : "DESISTIR", source: "chart", confidence: "alta", note: `${pos} RFI 100bb: ${hand} ${open ? "está" : "não está"} na range de abertura.` };
  }

  if (input.node === "vs_open") {
    if (!vs) return approx("Agressor não identificado: defesa sem chart validado.", { hand, position: pos, node: "vs_open" });
    const chart = VS_OPEN[`${pos}:${vs}`];
    if (!chart) return approx(`Sem chart validado para ${pos} vs abertura de ${vs} — use aproximação.`, { hand, position: pos, versus: vs, node: "vs_open" });
    const reference = chart.threebet.has(hand) ? "3-BET" : chart.call.has(hand) ? "PAGAR" : "DESISTIR";
    return { chart: CHART_VERSION, node: "vs_open", hand, position: pos, versus: vs, reference, source: "chart", confidence: "alta", note: `${pos} vs abertura de ${vs} (100bb, com rake): referência para ${hand} é ${reference}.` };
  }

  return approx("Node pré-flop desconhecido: sem chart aplicável.", { hand, position: pos });
};

export const classifyPreflopNode = (actionHistory: readonly string[] | null | undefined): { node: PreflopNode; versus: string | null; reason: string } => {
  const entries = (actionHistory ?? []).map((a) => String(a).toUpperCase().trim()).filter(Boolean);
  if (!entries.length) return { node: "unknown", versus: null, reason: "Sem histórico de ações." };
  const RAISE = /(RAISE|AUMENT|3-?BET|4-?BET|RERAISE)/; const CALL = /(CALL|PAGA|LIMP|IGUAL)/; const ALLIN = /(ALL-?IN|ALLIN|TUDO)/;
  let raises = 0; let calls = 0; let lastRaiser: string | null = null;
  for (const e of entries) { if (RAISE.test(e) || ALLIN.test(e)) { raises++; lastRaiser = e.match(/\b(UTG|HJ|MP|LJ|CO|BTN|BU|SB|BB)\b/)?.[1] ?? lastRaiser; } else if (CALL.test(e)) calls++; }
  if (raises === 0) return calls === 0 ? { node: "rfi", versus: null, reason: "Pote unopened." } : { node: "unknown", versus: null, reason: "Existe limp anterior: node de iso-raise/vs-limp fora da baseline auditada." };
  if (raises > 1) return { node: "unknown", versus: null, reason: "Mais de um raise pré-flop (3-bet, 4-bet, cold 4-bet ou call vs 3-bet): node fora da baseline auditada." };
  if (calls > 0) return { node: "unknown", versus: lastRaiser, reason: "Já existe call/limp além do agressor (squeeze ou pote com 3+ jogadores): node fora da baseline auditada." };
  return { node: "vs_open", versus: lastRaiser, reason: "Resposta a um único RFI." };
};
