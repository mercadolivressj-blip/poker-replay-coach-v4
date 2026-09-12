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

const tracker = activeTableStateTracker;
if (tracker && !tracker.__prcCapacityStabilizedR14) {
  const originalIngest = tracker.ingest.bind(tracker);
  tracker.ingest = (snapshot) => {
    const d = typeof window !== 'undefined' ? window.__prcAIStateR14 : null;
    const capacity = observeCapacity(d?.tableSize, Number(d?.seatsConfidence) || Number(snapshot?.confidence) || 0);

    // Important: physical capacity is only a display/layout fact. Do NOT inject empty
    // physical slots into the tracker, because poker positions skip empty seats.
    const result = originalIngest(snapshot);
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
