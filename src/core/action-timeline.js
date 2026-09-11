const ACTIONS = new Set(['fold','check','call','bet','raise','allin','show']);
const STREETS = new Set(['preflop','flop','turn','river','showdown']);

function actorKey(actorName, seatLabel) {
  return String(actorName || seatLabel || 'unknown').trim().toLowerCase();
}

function eventKey(e) {
  const amount = Number.isFinite(e.amount) ? Math.round(e.amount * 100) / 100 : '-';
  return [e.handId, e.street, actorKey(e.actorName, e.seatLabel), e.action, amount].join('|');
}

export class ActionTimeline {
  constructor() { this.resetSession(); }
  resetSession() { this.handId = 0; this.events = []; this.keys = new Set(); this.revealedHands = new Map(); }
  resetHand(handId) { this.handId = handId; this.events = []; this.keys.clear(); this.revealedHands.clear(); }
  append(event) {
    if (!event || event.handId !== this.handId) return false;
    if (!STREETS.has(event.street) || !ACTIONS.has(event.action)) return false;
    const key = eventKey(event); if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.events.push({
      seq: this.events.length + 1,
      handId: event.handId,
      street: event.street,
      actorName: event.actorName || null,
      seatLabel: event.seatLabel || null,
      action: event.action,
      amount: Number.isFinite(event.amount) ? event.amount : null,
      source: event.source || 'observer',
      confidence: Number.isFinite(event.confidence) ? event.confidence : 0,
      observedAt: event.observedAt ?? performance.now(),
    });
    return true;
  }
  reveal({ handId, actorName = null, seatLabel = null, cards = [], confidence = 0 }) {
    if (handId !== this.handId || !Array.isArray(cards) || cards.length !== 2 || cards.some((c) => !c?.rank)) return false;
    const key = actorKey(actorName, seatLabel); if (key === 'unknown') return false;
    this.revealedHands.set(key, { actorName, seatLabel, cards, confidence });
    return true;
  }
  eventsFor(actorName, seatLabel = null) {
    const key = actorKey(actorName, seatLabel);
    return this.events.filter((e) => actorKey(e.actorName, e.seatLabel) === key);
  }
  snapshot() { return { handId: this.handId, events: [...this.events], revealedHands: [...this.revealedHands.values()] }; }
}
