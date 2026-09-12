import { activeHandMachine } from '../core/state-machine.js';
import { ActionTimeline } from '../core/action-timeline.js';
import { TableStateTracker } from '../core/table-state-tracker.js';

// R14 used to import the resolver without ever instantiating the two live stores
// it reads from. Own them here so every replay hand has one public action timeline
// and one optional table snapshot tracker. Local chat OCR is loaded only after the
// timeline exists, otherwise its live binding is null during module evaluation.
const timeline = new ActionTimeline();
const tableTracker = new TableStateTracker();

const diagnostics = {
  handId: 0,
  resets: 0,
  eventCount: 0,
  actors: [],
  lastEvent: null,
};

if (typeof window !== 'undefined') {
  window.__prcReplayContextR14 = { timeline, tableTracker, diagnostics };
}

let lastHandId = -1;

function syncHand() {
  const machine = activeHandMachine;
  if (!machine) return;
  if (machine.handId !== lastHandId) {
    lastHandId = machine.handId;
    diagnostics.handId = machine.handId;
    diagnostics.resets++;
    if (machine.handId > 0) {
      timeline.resetHand(machine.handId);
      tableTracker.resetHand(machine.handId);
    } else {
      timeline.resetSession();
      tableTracker.resetSession();
    }
  }

  const events = timeline.events || [];
  diagnostics.eventCount = events.length;
  diagnostics.actors = [...new Set(events.map((e) => e.actorName).filter(Boolean))];
  diagnostics.lastEvent = events.at(-1) || null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('prc:generation-change', syncHand);
  setInterval(syncHand, 90);
  setTimeout(syncHand, 0);
}

// Must remain a dynamic import: ActionTimeline above has to be constructed first.
await import('./local-action-runtime.js');

export { timeline as replayActionTimelineR14, tableTracker as replayTableTrackerR14 };
