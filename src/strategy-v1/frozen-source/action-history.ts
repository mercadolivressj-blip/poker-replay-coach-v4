/**
 * Linha da mão: PREFLOP → FLOP → TURN → RIVER.
 * Reconstrói a sequência observada sem inventar nada. O que não foi lido fica ausente,
 * nunca preenchido por suposição.
 */
import { parseChips } from "./poker-state";

export type StreetName = "preflop" | "flop" | "turn" | "river";

export type ParsedAction = {
  street: StreetName;
  actor: string | null;
  action: "FOLD" | "CHECK" | "CALL" | "BET" | "RAISE" | "ALLIN" | "POST" | "DESCONHECIDA";
  /** Valor em fichas quando legível. */
  amount: number | null;
  /** Sizing em % do pote quando a fonte publica em %. */
  pct: number | null;
  raw: string;
};

export type HandLine = {
  actions: ParsedAction[];
  byStreet: Record<StreetName, ParsedAction[]>;
  preflopAggressor: string | null;
  /** Último agressor da street informada. */
  lastAggressor: (street: StreetName) => string | null;
  /** Quem pagou o open preflop. */
  preflopCallers: string[];
  /** Ação que o herói está enfrentando agora, quando legível. */
  facing: ParsedAction | null;
  /** Só true quando existe evidência textual real de all-in. */
  allInEvidence: boolean;
  /** Número de jogadores que seguiram além do preflop, quando derivável. */
  playersSeenPostflop: number | null;
  text: string;
};

const SEAT = /\b(UTG|HJ|MP|LJ|CO|BTN|BU|SB|BB|HERO|HERÓI|VILLAIN|VILÃO)\b/i;
const STREET_MARK: Record<string, StreetName> = {
  PREFLOP: "preflop",
  "PRÉ-FLOP": "preflop",
  FLOP: "flop",
  TURN: "turn",
  RIVER: "river",
};

const classify = (text: string): ParsedAction["action"] => {
  const v = text.toUpperCase();
  if (/(ALL-?IN|ALLIN|SHOVE|TUDO)/.test(v)) return "ALLIN";
  if (/(FOLD|DESIST|MUCK)/.test(v)) return "FOLD";
  if (/(CHECK|PASS|PULA)/.test(v)) return "CHECK";
  if (/(3-?BET|4-?BET|RAISE|AUMENT|RERAISE|OPEN|ISO)/.test(v)) return "RAISE";
  if (/(CALL|PAGA|LIMP)/.test(v)) return "CALL";
  if (/(BET|APOST|C-?BET|CBET|PROBE|DONK)/.test(v)) return "BET";
  if (/(POST|BLIND|ANTE)/.test(v)) return "POST";
  return "DESCONHECIDA";
};

export const parseHandLine = (
  history: readonly (string | null | undefined)[] | null | undefined,
  currentStreet?: StreetName | null,
): HandLine => {
  const actions: ParsedAction[] = [];
  let street: StreetName = "preflop";

  for (const entry of history ?? []) {
    const raw = String(entry ?? "").trim();
    if (!raw) continue;
    const upper = raw.toUpperCase();
    const bare = upper.replace(/[^A-ZÀ-Ú-]/g, "");
    if (STREET_MARK[bare]) {
      street = STREET_MARK[bare]!;
      continue;
    }
    // "FLOP: BB check" também muda a street.
    const inline = Object.keys(STREET_MARK).find((k) => upper.startsWith(`${k}:`));
    if (inline) street = STREET_MARK[inline]!;

    const action = classify(upper);
    if (action === "DESCONHECIDA" && !SEAT.test(upper)) continue;
    const pctMatch = raw.match(/(\d{1,3})\s*%/);
    const amount = pctMatch ? null : parseChips(raw.replace(/\b(2|3|4)-?BET\b/i, ""));
    actions.push({
      street,
      actor: raw.match(SEAT)?.[1]?.toUpperCase() ?? null,
      action,
      amount: amount ?? null,
      pct: pctMatch ? Number(pctMatch[1]) : null,
      raw,
    });
  }

  const byStreet: Record<StreetName, ParsedAction[]> = {
    preflop: actions.filter((a) => a.street === "preflop"),
    flop: actions.filter((a) => a.street === "flop"),
    turn: actions.filter((a) => a.street === "turn"),
    river: actions.filter((a) => a.street === "river"),
  };

  const aggressorOf = (s: StreetName) =>
    [...byStreet[s]].reverse().find((a) => a.action === "RAISE" || a.action === "BET" || a.action === "ALLIN")
      ?.actor ?? null;

  const openIdx = byStreet.preflop.findIndex((a) => a.action === "RAISE");
  const preflopCallers =
    openIdx >= 0
      ? byStreet.preflop
          .slice(openIdx + 1)
          .filter((a) => a.action === "CALL" && a.actor)
          .map((a) => a.actor!)
      : [];

  const last = actions[actions.length - 1] ?? null;
  const facing = last && ["BET", "RAISE", "ALLIN"].includes(last.action) ? last : null;
  const allInEvidence = actions.some((a) => a.action === "ALLIN");

  const seats = new Set(
    actions.filter((a) => a.street !== "preflop" && a.actor).map((a) => a.actor!),
  );
  const playersSeenPostflop = seats.size ? seats.size : null;

  const order: StreetName[] = ["preflop", "flop", "turn", "river"];
  const visible = currentStreet ? order.slice(0, order.indexOf(currentStreet) + 1) : order;
  const text = visible
    .filter((s) => byStreet[s].length)
    .map((s) => `${s.toUpperCase()}: ${byStreet[s].map((a) => a.raw).join(" → ")}`)
    .join("\n");

  return {
    actions,
    byStreet,
    preflopAggressor: aggressorOf("preflop"),
    lastAggressor: aggressorOf,
    preflopCallers,
    facing,
    allInEvidence,
    playersSeenPostflop,
    text,
  };
};

/** Street derivada SOMENTE da quantidade de cartas comunitárias confirmadas. */
export const streetFromBoard = (
  boardLength: number,
): StreetName | "analisando" =>
  boardLength === 0
    ? "preflop"
    : boardLength === 3
      ? "flop"
      : boardLength === 4
        ? "turn"
        : boardLength === 5
          ? "river"
          : "analisando";