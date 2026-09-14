const ACTIONS = new Set(['fold','check','call','bet','raise','allin']);

export let activeTableStateTracker = null;

const POSITIONS = {
  2: ['BTN/SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO'],
  10: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO'],
};

const MEMORY_MISS_FRAMES = 2;

function finite(v) { return Number.isFinite(v) ? v : null; }
function seatKey(s) { return `seat:${Number.isInteger(s?.seatIndex) ? s.seatIndex : 'unknown'}`; }
function byIndex(a, b) { return a.seatIndex - b.seatIndex; }
function normalizedName(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function isVacantSeat(seat) {
  const name = normalizedName(seat?.actorName);
  if (['lugar vazio','empty seat','seat open','assento vazio'].includes(name)) return true;
  return !seat?.hero && !seat?.actorName && !Number.isFinite(seat?.stack) && !Number.isFinite(seat?.committed);
}
function epsFor(...values) {
  const nums = values.map(Number).filter(Number.isFinite).map(Math.abs);
  const scale = nums.length ? Math.max(...nums) : 0;
  return scale >= 10 ? 0.5 : 0.0005;
}

function normalizeSeats(seats = []) {
  return seats
    .filter((s) => s && Number.isInteger(s.seatIndex) && Number.isFinite(s.confidence) && s.confidence >= 0.5)
    .map((s) => ({
      seatIndex: s.seatIndex,
      actorName: typeof s.actorName === 'string' && s.actorName.trim() ? s.actorName.trim() : null,
      stack: finite(s.stack),
      committed: finite(s.committed),
      dealer: Boolean(s.dealer),
      folded: typeof s.folded === 'boolean' ? s.folded : null,
      hero: Boolean(s.hero),
      visibleAction: ACTIONS.has(s.visibleAction) ? s.visibleAction : null,
      visibleActionAmount: finite(s.visibleActionAmount),
      confidence: s.confidence,
      memoryOnly: Boolean(s.memoryOnly),
      memoryMisses: Number.isInteger(s.memoryMisses) ? s.memoryMisses : 0,
    }))
    .sort(byIndex);
}

export function assignPositions(seats = []) {
  const normalized = normalizeSeats(seats);
  const occupied = normalized.filter((s) => !isVacantSeat(s));
  if (occupied.length < 2 || occupied.length > 10) return normalized.map((s) => ({ ...s, position: null }));
  const dealerIndex = occupied.findIndex((s) => s.dealer);
  if (dealerIndex < 0) return normalized.map((s) => ({ ...s, position: null }));
  const ordered = [...occupied.slice(dealerIndex), ...occupied.slice(0, dealerIndex)];
  const labels = POSITIONS[ordered.length] || [];
  const positionByKey = new Map(ordered.map((s, i) => [seatKey(s), labels[i] || null]));
  return normalized.map((s) => ({ ...s, position: isVacantSeat(s) ? null : (positionByKey.get(seatKey(s)) || null) }));
}

function mapSeats(seats) { return new Map(seats.map((s) => [seatKey(s), s])); }
function maxCommitted(seats) {
  const vals = seats.filter((s) => !isVacantSeat(s)).map((s) => finite(s.committed)).filter((v) => v !== null);
  return vals.length ? Math.max(...vals) : null;
}
function actorName(curr, prev = null) { return curr?.actorName || prev?.actorName || null; }

function eventFromVisibleAction(curr, street, confidence, prev = null) {
  if (isVacantSeat(curr) || !ACTIONS.has(curr.visibleAction)) return null;
  return {
    street,
    actorName: actorName(curr, prev),
    seatLabel: curr.position || prev?.position || `Seat ${curr.seatIndex + 1}`,
    action: curr.visibleAction,
    amount: finite(curr.visibleActionAmount) ?? (['bet','raise','call','allin'].includes(curr.visibleAction) ? finite(curr.committed) : null),
    source: 'table-action-text',
    confidence: Math.min(0.96, confidence),
  };
}

function carrySeat(prev, curr, { sameStreet = true } = {}) {
  if (!prev) return { ...curr, memoryOnly: false, memoryMisses: 0 };
  return {
    ...curr,
    actorName: curr.actorName || prev.actorName || null,
    stack: finite(curr.stack) ?? finite(prev.stack),
    committed: finite(curr.committed) ?? (sameStreet ? finite(prev.committed) : null),
    dealer: Boolean(curr.dealer || prev.dealer),
    folded: prev.folded === true ? true : curr.folded,
    hero: Boolean(curr.hero || prev.hero),
    // Never carry action text. An action must be observed in the current frame
    // or inferred from a fresh chip/stack transition.
    visibleAction: curr.visibleAction,
    visibleActionAmount: curr.visibleActionAmount,
    confidence: Math.max(curr.confidence, Math.min(prev.confidence || 0, curr.confidence + 0.08)),
    memoryOnly: false,
    memoryMisses: 0,
  };
}

export function stabilizeSeatEvidence(currentSeats = [], previousSeats = [], { sameStreet = true, heroSeatIndex = null, dealerSeatIndex = null } = {}) {
  const current = normalizeSeats(currentSeats);
  const previous = normalizeSeats(previousSeats);
  const prevByKey = mapSeats(previous);
  const currentKeys = new Set(current.map(seatKey));
  const out = current.map((seat) => carrySeat(prevByKey.get(seatKey(seat)), seat, { sameStreet }));

  for (const prev of previous) {
    const key = seatKey(prev);
    if (currentKeys.has(key) || isVacantSeat(prev)) continue;
    const misses = (prev.memoryMisses || 0) + 1;
    if (misses > MEMORY_MISS_FRAMES) continue;
    out.push({
      ...prev,
      committed: sameStreet ? finite(prev.committed) : null,
      // Missing from the current frame is not evidence of fold or action.
      folded: prev.folded === true ? true : null,
      visibleAction: null,
      visibleActionAmount: null,
      confidence: Math.max(0.5, Math.min(0.74, (prev.confidence || 0.6) * 0.84)),
      memoryOnly: true,
      memoryMisses: misses,
    });
  }

  let resolvedHero = Number.isInteger(heroSeatIndex) ? heroSeatIndex : null;
  if (resolvedHero === null) {
    const freshHero = out.filter((s) => !s.memoryOnly && s.hero && s.confidence >= 0.7);
    if (freshHero.length === 1) resolvedHero = freshHero[0].seatIndex;
  }
  if (resolvedHero !== null) {
    for (const seat of out) seat.hero = seat.seatIndex === resolvedHero;
  }

  let resolvedDealer = Number.isInteger(dealerSeatIndex) ? dealerSeatIndex : null;
  if (resolvedDealer === null) {
    const freshDealer = out.filter((s) => !s.memoryOnly && s.dealer && s.confidence >= 0.72);
    if (freshDealer.length === 1) resolvedDealer = freshDealer[0].seatIndex;
  }
  if (resolvedDealer !== null) {
    for (const seat of out) seat.dealer = seat.seatIndex === resolvedDealer;
  }

  return {
    seats: out.sort(byIndex),
    heroSeatIndex: resolvedHero,
    dealerSeatIndex: resolvedDealer,
  };
}

export class TableStateTracker {
  constructor() { activeTableStateTracker = this; this.resetSession(); }

  resetSession() {
    this.handId = 0;
    this.street = null;
    this.previous = null;
    this.latest = null;
    this.readyForDiff = false;
    this.seatMemory = [];
    this.heroSeatIndex = null;
    this.dealerSeatIndex = null;
  }

  resetHand(handId) {
    this.handId = handId;
    this.street = null;
    this.previous = null;
    this.latest = null;
    this.readyForDiff = false;
    this.seatMemory = [];
    this.heroSeatIndex = null;
    this.dealerSeatIndex = null;
  }

  ingest(snapshot) {
    if (!snapshot || snapshot.handId !== this.handId) return { accepted: false, events: [], state: this.latest };
    const sameStreet = this.street === null || this.street === snapshot.street;
    const stabilized = stabilizeSeatEvidence(snapshot.seats || [], this.seatMemory, {
      sameStreet,
      heroSeatIndex: this.heroSeatIndex,
      dealerSeatIndex: this.dealerSeatIndex,
    });
    this.heroSeatIndex = stabilized.heroSeatIndex;
    this.dealerSeatIndex = stabilized.dealerSeatIndex;
    this.seatMemory = stabilized.seats.map((s) => ({ ...s }));
    const seats = assignPositions(stabilized.seats);
    const next = {
      handId: snapshot.handId,
      street: snapshot.street,
      confidence: Number.isFinite(snapshot.confidence) ? snapshot.confidence : 0,
      seats,
      dealerSeat: seats.find((s) => s.dealer && !isVacantSeat(s))?.seatIndex ?? null,
      heroSeat: seats.find((s) => s.hero)?.seatIndex ?? null,
      heroPosition: seats.find((s) => s.hero)?.position ?? null,
      freshSeatCount: seats.filter((s) => !s.memoryOnly).length,
      memorySeatCount: seats.filter((s) => s.memoryOnly).length,
      observedAt: performance.now(),
    };

    if (this.street !== next.street) {
      this.street = next.street;
      this.previous = next;
      this.latest = next;
      this.readyForDiff = true;
      return { accepted: true, events: visibleEvents(next), state: next, baseline: true };
    }

    if (!this.readyForDiff || !this.previous) {
      this.previous = next;
      this.latest = next;
      this.readyForDiff = true;
      return { accepted: true, events: visibleEvents(next), state: next, baseline: true };
    }

    const events = inferEvents(this.previous, next);
    this.previous = next;
    this.latest = next;
    return { accepted: true, events, state: next, baseline: false };
  }
}

function visibleEvents(snapshot) {
  const events = [];
  for (const curr of snapshot?.seats || []) {
    if (curr.memoryOnly || isVacantSeat(curr)) continue;
    const confidence = curr.confidence || 0;
    if (confidence < 0.62) continue;
    const explicit = eventFromVisibleAction(curr, snapshot.street, confidence);
    if (explicit) events.push(explicit);
  }
  return events;
}

export function inferEvents(previous, next) {
  if (!previous || !next || previous.handId !== next.handId || previous.street !== next.street) return [];
  const oldSeats = mapSeats(previous.seats || []);
  const newSeats = mapSeats(next.seats || []);
  const oldMax = maxCommitted(previous.seats || []);
  const events = [];

  for (const [key, curr] of newSeats) {
    const prev = oldSeats.get(key);
    if (!prev || curr.memoryOnly || isVacantSeat(curr) || isVacantSeat(prev)) continue;
    const confidence = Math.min(prev.confidence || 0, curr.confidence || 0);
    if (confidence < 0.62) continue;

    const explicit = eventFromVisibleAction(curr, next.street, curr.confidence || confidence, prev);
    if (explicit) {
      events.push(explicit);
      continue;
    }

    if (curr.folded === true && prev.folded !== true) {
      events.push({
        street: next.street,
        actorName: actorName(curr, prev),
        seatLabel: curr.position || prev.position || `Seat ${curr.seatIndex + 1}`,
        action: 'fold',
        amount: null,
        source: 'table-diff',
        confidence: Math.min(0.94, confidence),
      });
      continue;
    }

    const prevCommitted = finite(prev.committed);
    const currCommitted = finite(curr.committed);
    if (prevCommitted === null || currCommitted === null) continue;
    const eps = epsFor(prevCommitted, currCommitted, oldMax);
    if (currCommitted <= prevCommitted + eps) continue;
    const delta = currCommitted - prevCommitted;
    const stackDropped = finite(prev.stack) !== null && finite(curr.stack) !== null ? prev.stack - curr.stack : null;
    if (stackDropped !== null && Math.abs(stackDropped - delta) > Math.max(eps * 4, delta * 0.2)) continue;

    let action = null;
    if (finite(curr.stack) !== null && curr.stack <= eps) action = 'allin';
    else if (oldMax !== null && prevCommitted + eps < oldMax && Math.abs(currCommitted - oldMax) <= eps) action = 'call';
    else if (oldMax !== null && currCommitted > oldMax + eps) action = oldMax <= eps ? 'bet' : 'raise';
    else if (oldMax !== null && oldMax <= eps && currCommitted > eps) action = 'bet';

    if (!action) continue;
    events.push({
      street: next.street,
      actorName: actorName(curr, prev),
      seatLabel: curr.position || prev.position || `Seat ${curr.seatIndex + 1}`,
      action,
      amount: currCommitted,
      source: 'table-diff',
      confidence: Math.min(0.9, confidence * (stackDropped === null ? 0.82 : 0.96)),
    });
  }
  return events;
}
