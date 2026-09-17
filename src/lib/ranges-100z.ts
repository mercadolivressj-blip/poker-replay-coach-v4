/**
 * BASELINE HIGH-RAKE PRINCIPAL — cash6max-100z-highrake-v1.
 */
import { BASELINE_META, RFI_100Z, VS_RFI_100Z } from "./ranges-100z.data";
import type { Position } from "./ranges-6max";

export { BASELINE_META };
export const BASELINE_VERSION = BASELINE_META.version;
export type ActionKey = "fold" | "call" | "raise" | "limp";
export type ActionDistribution = Record<ActionKey, number>;
export type BaselineEntry = {
  hand: string; node: "rfi" | "vs_open"; position: Position; versus: Position | null;
  distribution: ActionDistribution; mixed: boolean; frequencyModel: string;
};

const parseChart = (encoded: string): Map<string, ActionDistribution> => {
  const map = new Map<string, ActionDistribution>();
  for (const part of encoded.split(",")) {
    if (!part) continue;
    const [hand, freqs] = part.split("=");
    const [call, raise, limp] = (freqs ?? "").split("/").map((n) => Number(n) || 0);
    const c = call ?? 0, r = raise ?? 0, l = limp ?? 0;
    map.set(hand!, { fold: Math.max(0, 100 - c - r - l), call: c, raise: r, limp: l });
  }
  return map;
};

const ALL_FOLD: ActionDistribution = { fold: 100, call: 0, raise: 0, limp: 0 };
const RFI_CHARTS = new Map<string, Map<string, ActionDistribution>>(Object.entries(RFI_100Z).map(([k, v]) => [k, parseChart(v)]));
const VS_CHARTS = new Map<string, Map<string, ActionDistribution>>(Object.entries(VS_RFI_100Z).map(([k, v]) => [k, parseChart(v)]));

export const baselineRfiPositions = () => [...RFI_CHARTS.keys()];
export const baselineVsNodes = () => [...VS_CHARTS.keys()];
export const baselineChart = (key: string) => RFI_CHARTS.get(key) ?? VS_CHARTS.get(key) ?? null;
const isMixed = (d: ActionDistribution) => (["fold", "call", "raise", "limp"] as ActionKey[]).filter((k) => d[k] > 0).length > 1;

export const lookupBaseline = (input: { hand: string; position: Position; versus?: Position | null; node: "rfi" | "vs_open"; }): BaselineEntry | null => {
  const chart = input.node === "rfi" ? RFI_CHARTS.get(input.position) : input.versus ? VS_CHARTS.get(`${input.position}:${input.versus}`) : undefined;
  if (!chart) return null;
  const distribution = chart.get(input.hand) ?? ALL_FOLD;
  return { hand: input.hand, node: input.node, position: input.position, versus: input.node === "rfi" ? null : (input.versus ?? null), distribution, mixed: isMixed(distribution), frequencyModel: BASELINE_META.frequencyModel };
};

export type ActionLabel = "ABRIR" | "3-BET" | "PAGAR" | "LIMP" | "DESISTIR";
export type BaselinePresentation = {
  primary: ActionKey | null; label: ActionLabel | "ESTRATÉGIA MISTA"; mixed: boolean; undecided: boolean;
  actions: { action: ActionKey; label: ActionLabel; freq: number }[]; text: string;
};

const LABELS: Record<ActionKey, { rfi: ActionLabel; vs: ActionLabel }> = {
  raise: { rfi: "ABRIR", vs: "3-BET" }, call: { rfi: "PAGAR", vs: "PAGAR" }, limp: { rfi: "LIMP", vs: "PAGAR" }, fold: { rfi: "DESISTIR", vs: "DESISTIR" },
};
const ORDER_PREF: ActionKey[] = ["raise", "call", "limp", "fold"];

export const presentBaseline = (entry: BaselineEntry): BaselinePresentation => {
  const d = entry.distribution; const isRfi = entry.node === "rfi";
  const actions = ORDER_PREF.filter((k) => d[k] > 0).map((k) => ({ action: k, label: LABELS[k][isRfi ? "rfi" : "vs"], freq: d[k] }));
  const top = actions.reduce((a, b) => (b.freq > a.freq ? b : a), actions[0]!);
  const undecided = entry.mixed && top.freq <= 50;
  if (undecided) {
    const neutral = [...actions].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    const freqs = neutral.map((a) => `${a.label} ${a.freq}%`).join(" / ");
    return { primary: null, label: "ESTRATÉGIA MISTA", mixed: true, undecided: true, actions: neutral, text: `ESTRATÉGIA MISTA — ${freqs}. A baseline simplificada publica as duas ações com essa frequência e não estabelece que uma dessas ações seja melhor que a outra; a ordem em que aparecem não indica prioridade. Frequência exata do solver original desconhecida.` };
  }
  const others = actions.filter((a) => a.action !== top.action).map((a) => a.label);
  const text = entry.mixed ? `${top.label} — a baseline simplificada utiliza esta ação em frequência mista (${top.freq}%); ${others.join(" e ")} também faz parte da baseline. Frequência exata do solver original desconhecida.` : `${top.label} — ação única da baseline para esta mão.`;
  return { primary: top.action, label: top.label, mixed: entry.mixed, undecided: false, actions, text };
};
