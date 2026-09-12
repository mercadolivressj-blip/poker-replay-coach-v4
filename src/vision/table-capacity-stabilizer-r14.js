import { activeTableStateTracker } from '../core/table-state-tracker.js';

let candidate = null;
let candidateHits = 0;
let lockedCapacity = null;
let contradiction = null;
let contradictionHits = 0;

function validCapacity(value) {
  return Number.isInteger(value) && value >= 2 && value <= 10 ? value : null;
}

function observeCapacity(raw, confidence = 0) {
  const value = validCapacity(raw);
  if (!value || confidence < 0.76) return lockedCapacity;

  if (!lockedCapacity) {
    if (candidate === value) candidateHits++;
    else { candidate = value; candidateHits = 1; }
    if (candidateHits >= 2) {
      lockedCapacity = value;
      contradiction = null;
      contradictionHits = 0;
    }
    return lockedCapacity || candidate;
  }

  if (value === lockedCapacity) {
    contradiction = null;
    contradictionHits = 0;
    return lockedCapacity;
  }

  if (confidence < 0.90) return lockedCapacity;
  if (contradiction === value) contradictionHits++;
  else { contradiction = value; contradictionHits = 1; }
  if (contradictionHits >= 4) {
    lockedCapacity = value;
    candidate = value;
    candidateHits = 4;
    contradiction = null;
    contradictionHits = 0;
  }
  return lockedCapacity;
}

function withPhysicalSlots(snapshot, capacity) {
  if (!capacity || !Array.isArray(snapshot?.seats)) return snapshot;
  const byIndex = new Map();
  for (const seat of snapshot.seats) {
    if (!Number.isInteger(seat?.seatIndex) || seat.seatIndex < 0 || seat.seatIndex >= capacity) continue;
    byIndex.set(seat.seatIndex, seat);
  }
  for (let seatIndex = 0; seatIndex < capacity; seatIndex++) {
    if (byIndex.has(seatIndex)) continue;
    byIndex.set(seatIndex, {
      seatIndex,
      actorName: null,
      stack: null,
      committed: null,
      dealer: false,
      folded: true,
      hero: false,
      visibleAction: null,
      visibleActionAmount: null,
      confidence: 0.5,
      emptyPhysicalSlot: true,
    });
  }
  return { ...snapshot, tableSize: capacity, seats: [...byIndex.values()].sort((a, b) => a.seatIndex - b.seatIndex) };
}

const tracker = activeTableStateTracker;
if (tracker && !tracker.__prcCapacityStabilizedR14) {
  const originalIngest = tracker.ingest.bind(tracker);
  tracker.ingest = (snapshot) => {
    const d = typeof window !== 'undefined' ? window.__prcAIStateR14 : null;
    const capacity = observeCapacity(d?.tableSize, Number(d?.seatsConfidence) || Number(snapshot?.confidence) || 0);
    const result = originalIngest(withPhysicalSlots(snapshot, capacity));
    if (capacity && result?.state) {
      result.state.tableSize = capacity;
      if (tracker.latest) tracker.latest.tableSize = capacity;
      if (tracker.previous) tracker.previous.tableSize = capacity;
    }
    if (d && capacity) {
      d.tableSize = capacity;
      d.tableSizeLocked = Boolean(lockedCapacity);
    }
    return result;
  };
  tracker.__prcCapacityStabilizedR14 = true;
}

if (typeof window !== 'undefined') {
  window.__prcTableCapacityR14 = {
    get locked() { return lockedCapacity; },
    get candidate() { return candidate; },
    get candidateHits() { return candidateHits; },
  };
}
