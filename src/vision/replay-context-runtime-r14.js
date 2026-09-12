import { activeHandMachine } from '../core/state-machine.js';
import { ActionTimeline } from '../core/action-timeline.js';
import { TableStateTracker } from '../core/table-state-tracker.js';

// R14 owns one public-state timeline and one table tracker per replay hand.
// The primary evidence source is the PokerStars table itself. Chat OCR is not
// required for the resolver path.
const timeline = new ActionTimeline();
const tableTracker = new TableStateTracker();

const diagnostics = {
  handId: 0,
  resets: 0,
  eventCount: 0,
  actors: [],
  lastEvent: null,
  source: 'visual-table-r14b',
};

if (typeof window !== 'undefined') window.__prcReplayContextR14 = { timeline, tableTracker, diagnostics };

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

// The adaptive reader supports both 6-max and 9-max and publishes a hard
// trust signal. No action is appended until the visual table is validated.
await import('./visual-table-runtime-r14b.js');

export { timeline as replayActionTimelineR14, tableTracker as replayTableTrackerR14 };
