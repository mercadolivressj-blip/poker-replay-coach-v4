/**
 * SEAT ZONES — regiões FÍSICAS de ação por assento (layout 6-max do replayer).
 */
export type SeatRect = { x: number; y: number; w: number; h: number };
export type SeatZone = {
  index: number; id: string; x: number; y: number; w: number; h: number;
  plate: SeatRect; dealer: SeatRect; bet: SeatRect;
};

export const SEAT_ZONES_6MAX: readonly SeatZone[] = [
  { index: 1, id: "S1", x: 0.4, y: 0.55, w: 0.255, h: 0.24, plate: { x: 0.4, y: 0.68, w: 0.2, h: 0.11 }, dealer: { x: 0.6, y: 0.585, w: 0.055, h: 0.05 }, bet: { x: 0.44, y: 0.55, w: 0.12, h: 0.07 } },
  { index: 2, id: "S2", x: 0.11, y: 0.47, w: 0.275, h: 0.21, plate: { x: 0.11, y: 0.57, w: 0.2, h: 0.11 }, dealer: { x: 0.33, y: 0.55, w: 0.055, h: 0.05 }, bet: { x: 0.24, y: 0.47, w: 0.12, h: 0.07 } },
  { index: 3, id: "S3", x: 0.09, y: 0.21, w: 0.27, h: 0.2, plate: { x: 0.09, y: 0.21, w: 0.2, h: 0.11 }, dealer: { x: 0.3, y: 0.27, w: 0.055, h: 0.05 }, bet: { x: 0.24, y: 0.34, w: 0.12, h: 0.07 } },
  { index: 4, id: "S4", x: 0.345, y: 0.11, w: 0.255, h: 0.2, plate: { x: 0.4, y: 0.11, w: 0.2, h: 0.11 }, dealer: { x: 0.345, y: 0.17, w: 0.055, h: 0.05 }, bet: { x: 0.44, y: 0.24, w: 0.12, h: 0.07 } },
  { index: 5, id: "S5", x: 0.64, y: 0.21, w: 0.27, h: 0.2, plate: { x: 0.71, y: 0.21, w: 0.2, h: 0.11 }, dealer: { x: 0.645, y: 0.27, w: 0.055, h: 0.05 }, bet: { x: 0.64, y: 0.34, w: 0.12, h: 0.07 } },
  { index: 6, id: "S6", x: 0.625, y: 0.47, w: 0.265, h: 0.21, plate: { x: 0.69, y: 0.57, w: 0.2, h: 0.11 }, dealer: { x: 0.625, y: 0.55, w: 0.055, h: 0.05 }, bet: { x: 0.64, y: 0.47, w: 0.12, h: 0.07 } },
] as const;

export const SEAT_REGION_MAX_WIDTH = 0.22;
const disjoint = (a: SeatRect, b: SeatRect): boolean => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
export const seatRegionsDisjoint = (zone: SeatZone): boolean => disjoint(zone.plate, zone.bet);
export const seatAllRegionsDisjoint = (zone: SeatZone): boolean => disjoint(zone.plate, zone.bet) && disjoint(zone.plate, zone.dealer) && disjoint(zone.bet, zone.dealer);
export const seatZoneByIndex = (index: number): SeatZone | null => SEAT_ZONES_6MAX.find((z) => z.index === index) ?? null;

export type SeatPositionMap = Record<number, string | null>;
export const seatLabel = (index: number, map: SeatPositionMap | null | undefined): string => {
  const mapped = map?.[index];
  if (mapped && mapped.trim()) return mapped.trim().toUpperCase();
  return seatZoneByIndex(index)?.id ?? `S${index}`;
};

export const buildSeatPositionMap = (
  seats: readonly { index?: number | null; seat?: number | null; position?: string | null }[] | null | undefined,
): SeatPositionMap => {
  const map: SeatPositionMap = {};
  for (const s of seats ?? []) {
    const i = typeof s?.index === "number" ? s.index : typeof s?.seat === "number" ? s.seat : null;
    const p = (s?.position ?? "").trim();
    if (i === null || !p) continue;
    map[i] = p.toUpperCase();
  }
  return map;
};

const ORDER_6MAX: Record<number, readonly string[]> = {
  2: ["BTN", "BB"], 3: ["BTN", "SB", "BB"], 4: ["BTN", "SB", "BB", "UTG"],
  5: ["BTN", "SB", "BB", "UTG", "CO"], 6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
};

export type PositionDerivationInput = { occupiedSeats: readonly number[]; dealerSeats: readonly number[]; tableSize?: "6max" | "9max" };
export const derivePositionMap = (input: PositionDerivationInput): SeatPositionMap => {
  if ((input.tableSize ?? "6max") !== "6max") return {};
  if (input.dealerSeats.length !== 1) return {};
  const dealer = input.dealerSeats[0]!;
  const valid = SEAT_ZONES_6MAX.map((z) => z.index);
  const occupied = [...new Set(input.occupiedSeats)].filter((i) => valid.includes(i)).sort((a, b) => a - b);
  if (occupied.length !== new Set(input.occupiedSeats).size) return {};
  if (!occupied.includes(dealer)) return {};
  const order = ORDER_6MAX[occupied.length];
  if (!order) return {};
  const start = occupied.indexOf(dealer);
  const map: SeatPositionMap = {};
  order.forEach((position, step) => { map[occupied[(start + step) % occupied.length]!] = position; });
  return map;
};

export const dealtInSeats = (seats: readonly { seat: number | null; isActive?: boolean }[]): number[] =>
  seats.map((s) => s.seat).filter((s): s is number => typeof s === "number");
