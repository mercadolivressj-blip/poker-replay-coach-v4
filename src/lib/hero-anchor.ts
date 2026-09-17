/**
 * ÂNCORAS OBJETIVAS DE POSIÇÃO DO HERÓI (V2.4.1).
 */
import { bigBlindOf, normalizeActions, parseChips } from "./poker-state";
import { derivePositionMap, type SeatPositionMap } from "./seat-zones";

export type HeroAnchorSource = "explicit-blind" | "bb-check-wager" | "sb-price-unopened" | "orbit" | "dealer";
export type HeroPositionAnchor = { position: "SB" | "BB"; source: HeroAnchorSource; detail: string };
export const chipsNear = (a: number, b: number, bb: number): boolean => Math.abs(a - b) <= Math.max(bb * 0.25, 0.005);

export const blindPairOf = (blinds: string | null | undefined): { sb: number; bb: number } | null => {
  const bb = bigBlindOf(blinds ?? null);
  if (bb === null || !(bb > 0)) return null;
  const parts = (blinds ?? "").match(/\d[\d.,]*/g) ?? [];
  const sb = parts.length >= 2 ? parseChips(parts[0]) : null;
  return { sb: sb && sb > 0 ? sb : bb / 2, bb };
};

export type HeroAnchorInput = {
  heroSeat: number; board?: readonly string[] | null;
  tiles?: readonly { index: number; blindPost?: "SB" | "BB" | null }[] | null;
  legalActions?: readonly string[] | null; heroWager?: number | null; blinds?: string | null;
  pot?: string | null; toCall?: string | null; unopened?: boolean | null;
};

export const deriveHeroPositionAnchor = (input: HeroAnchorInput): HeroPositionAnchor | null => {
  if ((input.board?.length ?? 0) !== 0) return null;
  for (const tile of input.tiles ?? []) {
    if (tile?.index !== input.heroSeat) continue;
    if (tile.blindPost === "BB") return { position: "BB", source: "explicit-blind", detail: "Post de BIG BLIND escrito no assento físico do herói." };
    if (tile.blindPost === "SB") return { position: "SB", source: "explicit-blind", detail: "Post de SMALL BLIND escrito no assento físico do herói." };
  }
  const pair = blindPairOf(input.blinds ?? null);
  if (!pair) return null;
  const { sb, bb } = pair;
  const legal = normalizeActions([...(input.legalActions ?? [])]);
  const wager = input.heroWager;
  const hasWager = typeof wager === "number" && Number.isFinite(wager) && wager > 0;
  if (legal.includes("CHECK") && !legal.includes("CALL")) {
    if (!legal.includes("RAISE") && !legal.includes("BET")) return null;
    if (!hasWager || !chipsNear(wager as number, bb, bb)) return null;
    return { position: "BB", source: "bb-check-wager", detail: "Pré-flop com CHECK legal, sem CALL, e exatamente 1 BB já apostada pelo herói: só a BIG BLIND pode estar nesse estado." };
  }
  if (input.unopened !== true) return null;
  if (legal.includes("CHECK")) return null;
  if (!legal.includes("FOLD") || !legal.includes("CALL")) return null;
  if (!legal.includes("RAISE") && !legal.includes("BET")) return null;
  const pot = parseChips(input.pot ?? null);
  if (pot === null || !chipsNear(pot, sb + bb, bb)) return null;
  const toCall = parseChips(input.toCall ?? null);
  if (toCall === null || !(toCall > 0) || !chipsNear(toCall, bb - sb, bb)) return null;
  if (hasWager && !chipsNear(wager as number, sb, bb)) return null;
  return { position: "SB", source: "sb-price-unopened", detail: "Pré-flop não aberto, pote igual às blinds e preço igual à diferença BB-SB com FOLD/CALL/RAISE sem CHECK: só a SMALL BLIND paga esse preço." };
};

export type AnchorMapInput = { heroSeat: number; position: string; occupiedSeats: readonly number[]; tableSize?: "6max" | "9max" };
export const mapFromHeroAnchor = (input: AnchorMapInput): SeatPositionMap | null => {
  const target = input.position.trim().toUpperCase();
  if (!target) return null;
  const occupied = [...new Set(input.occupiedSeats)].sort((a, b) => a - b);
  if (!occupied.includes(input.heroSeat)) return null;
  let found: SeatPositionMap | null = null;
  for (const dealer of occupied) {
    const map = derivePositionMap({ occupiedSeats: occupied, dealerSeats: [dealer], tableSize: input.tableSize ?? "6max" });
    if ((map[input.heroSeat] ?? "").toUpperCase() !== target) continue;
    if (found) return null;
    found = map;
  }
  return found;
};

export type BlindWagerMapInput = { heroSeat: number; board?: readonly string[] | null; blinds?: string | null; wagers?: Record<number, number> | null; occupiedSeats: readonly number[]; tableSize?: "6max" | "9max" };
export type BlindWagerMap = { map: SeatPositionMap; sbSeat: number; dealerSeat: number };
export const mapFromBlindWagers = (input: BlindWagerMapInput): BlindWagerMap | null => {
  if ((input.board?.length ?? 0) !== 0) return null;
  const pair = blindPairOf(input.blinds ?? null);
  if (!pair) return null;
  const { sb, bb } = pair;
  if (!(sb > 0) || !(sb < bb)) return null;
  const wagers = input.wagers ?? {};
  const sbSeats = Object.entries(wagers).filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0).filter(([, value]) => chipsNear(value as number, sb, bb)).map(([seat]) => Number(seat)).filter((seat) => Number.isFinite(seat));
  if (sbSeats.length !== 1) return null;
  const sbSeat = sbSeats[0]!;
  const occupied = [...new Set([...input.occupiedSeats, sbSeat])].sort((a, b) => a - b);
  if (occupied.length < 2 || !occupied.includes(input.heroSeat)) return null;
  let found: BlindWagerMap | null = null;
  for (const dealer of occupied) {
    const map = derivePositionMap({ occupiedSeats: occupied, dealerSeats: [dealer], tableSize: input.tableSize ?? "6max" });
    if ((map[sbSeat] ?? "").toUpperCase() !== "SB" || !map[input.heroSeat]) continue;
    if (found) return null;
    found = { map, sbSeat, dealerSeat: dealer };
  }
  return found;
};

export const HERO_NAME_ALIASES = ["voce", "você", "hero", "herói", "heroi", "eu", "wruckzinho"];
const HERO_ALIASES = new Set(HERO_NAME_ALIASES);
const isHeroRow = (row: { isHero?: boolean | null; name?: string | null }, heroNames: readonly string[]): boolean => {
  if (row.isHero === true) return true;
  const name = (row.name ?? "").trim().toLowerCase();
  if (!name) return false;
  if (HERO_ALIASES.has(name)) return true;
  return heroNames.some((n) => n.trim().toLowerCase() === name);
};

export const applyCanonicalPositions = <T extends { seat: number | null; position: string | null; isHero?: boolean | null; name?: string | null }>(
  seats: readonly T[], map: SeatPositionMap | null | undefined, heroSeat: number, heroNames: readonly string[] = [],
): T[] => seats.map((s) => isHeroRow(s, heroNames) ? { ...s, seat: heroSeat, position: map?.[heroSeat] ?? null } : { ...s, position: typeof s.seat === "number" ? (map?.[s.seat] ?? null) : null });

export const heroPositionConsistent = (displayed: string | null | undefined, map: SeatPositionMap | null | undefined, heroSeat: number): boolean => {
  const canonical = (map?.[heroSeat] ?? null)?.toUpperCase() ?? null;
  const shown = (displayed ?? null)?.trim().toUpperCase() || null;
  return canonical === shown;
};
export const chipsOf = (text: string | null | undefined): number | null => parseChips(text ?? null);
