const EPS = 0.5;
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

function finite(v) { return Number.isFinite(v) ? v : null; }
function seatKey(s) { return `seat:${Number.isInteger(s?.seatIndex) ? s.seatIndex : 'unknown'}`; }
function byIndex(a, b) { return a.seatIndex - b.seatIndex; }

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
    }))
    .sort(byIndex);
}

export function assignPositions(seats = []) {
  const normalized = normalizeSeats(seats);
  if (normalized.length < 2 || normalized.length > 10) return normalized.map((s) => ({ ...s, position: null }));
  const dealerIndex = normalized.findIndex((s) => s.dealer);
  if (dealerIndex < 0) return normalized.map((s) => ({ ...s, position: null }));
  const ordered = [...normalized.slice(dealerIndex), ...normalized.slice(0, dealerIndex)];
  const labels = POSITIONS[ordered.length] || [];
  const positionByKey = new Map(ordered.map((s, i) => [seatKey(s), labels[i] || null]));
  return normalized.map((s) => ({ ...s, position: positionByKey.get(seatKey(s)) || null }));
}

function mapSeats(seats) { return new Map(seats.map((s) => [seatKey(s), s])); }
function maxCommitted(seats) {
  const vals = seats.map((s) => finite(s.committed)).filter((v) => v !== null);
  return vals.length ? Math.max(...vals) : null;
}
function actorName(curr, prev = null) { return curr?.actorName || prev?.actorName || null; }

function eventFromVisibleAction(curr, street, confidence, prev = null) {
  if (!ACTIONS.has(curr.visibleAction)) return null;
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

export class TableStateTracker {
  constructor() { activeTableStateTracker = this; this.resetSession(); }

  resetSession() {
    this.handId = 0;
    this.street = null;
    this.previous = null;
    this.latest = null;
    this.readyForDiff = false;
  }

  resetHand(handId) {
    this.handId = handId;
    this.street = null;
    this.previous = null;
    this.latest = null;
    this.readyForDiff = false;
  }

  ingest(snapshot) {
    if (!snapshot || snapshot.handId !== this.handId) return { accepted: false, events: [], state: this.latest };
    const seats = assignPositions(snapshot.seats || []);
    const next = {
      handId: snapshot.handId,
      street: snapshot.street,
      confidence: Number.isFinite(snapshot.confidence) ? snapshot.confidence : 0,
      seats,
      dealerSeat: seats.find((s) => s.dealer)?.seatIndex ?? null,
      heroSeat: seats.find((s) => s.hero)?.seatIndex ?? null,
      heroPosition: seats.find((s) => s.hero)?.position ?? null,
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
    if (!prev) continue;
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
    if (prevCommitted === null || currCommitted === null || currCommitted <= prevCommitted + EPS) continue;
    const delta = currCommitted - prevCommitted;
    const stackDropped = finite(prev.stack) !== null && finite(curr.stack) !== null ? prev.stack - curr.stack : null;
    if (stackDropped !== null && Math.abs(stackDropped - delta) > Math.max(2, delta * 0.2)) continue;

    let action = null;
    if (finite(curr.stack) !== null && curr.stack <= EPS) action = 'allin';
    else if (oldMax !== null && prevCommitted + EPS < oldMax && Math.abs(currCommitted - oldMax) <= EPS) action = 'call';
    else if (oldMax !== null && currCommitted > oldMax + EPS) action = oldMax <= EPS ? 'bet' : 'raise';
    else if (oldMax !== null && oldMax <= EPS && currCommitted > EPS) action = 'bet';

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
