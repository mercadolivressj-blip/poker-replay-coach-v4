import { activeHandMachine } from '../core/state-machine.js';
import { ActionTimeline } from '../core/action-timeline.js';
import { TableStateTracker } from '../core/table-state-tracker.js';

// R14 owns one public-state timeline and one table tracker per replay hand.
// Primary evidence now comes from a whole-frame AI read of the replay. Local
// OCR/seat geometry is no longer allowed to create strategic truth.
const timeline = new ActionTimeline();
const tableTracker = new TableStateTracker();

const diagnostics = {
  handId: 0,
  resets: 0,
  eventCount: 0,
  actors: [],
  lastEvent: null,
  source: 'ai-full-frame-r14',
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

await import('./ai-full-state-runtime-r14.js');

export { timeline as replayActionTimelineR14, tableTracker as replayTableTrackerR14 };
