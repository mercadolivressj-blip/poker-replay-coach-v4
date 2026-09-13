import { activeHandMachine } from '../core/state-machine.js';

const diagnostics = {
  enabled: true,
  installs: 0,
  filteredReads: 0,
  lastLocalTypes: [],
  lastRawTypes: [],
  lastFilteredTypes: [],
};

function legalLocalActions() {
  const actions = Array.isArray(activeHandMachine?.state?.actions) ? activeHandMachine.state.actions : [];
  const types = [...new Set(actions.map((action) => String(action?.type || '')).filter(Boolean))];
  const facingBet = types.includes('fold') && types.includes('call');
  const unopened = types.includes('check') && types.includes('bet');
  return facingBet || unopened ? new Set(types) : null;
}

function install() {
  if (typeof window === 'undefined') return false;
  const d = window.__prcAIDecisionR14;
  if (!d || d.__prcLegalActionGuardR14) return false;

  const descriptor = Object.getOwnPropertyDescriptor(d, 'actions');
  let backing = Array.isArray(d.actions) ? d.actions : [];
  const upstreamGet = descriptor?.get;
  const upstreamSet = descriptor?.set;

  Object.defineProperty(d, 'actions', {
    configurable: true,
    enumerable: true,
    get() {
      const raw = upstreamGet ? upstreamGet.call(d) : backing;
      const safeRaw = Array.isArray(raw) ? raw : [];
      const legal = legalLocalActions();
      diagnostics.lastRawTypes = safeRaw.map((action) => action?.type).filter(Boolean);
      if (!legal) {
        diagnostics.lastFilteredTypes = diagnostics.lastRawTypes.slice();
        return safeRaw;
      }

      diagnostics.lastLocalTypes = [...legal];
      const filtered = safeRaw.filter((action) => legal.has(String(action?.type || '')));
      diagnostics.lastFilteredTypes = filtered.map((action) => action?.type).filter(Boolean);
      if (filtered.length !== safeRaw.length) diagnostics.filteredReads++;
      return filtered;
    },
    set(value) {
      if (upstreamSet) upstreamSet.call(d, value);
      else backing = Array.isArray(value) ? value : [];
    },
  });

  d.__prcLegalActionGuardR14 = true;
  diagnostics.installs++;
  return true;
}

if (typeof window !== 'undefined') {
  window.__prcLegalActionGuardR14 = diagnostics;
  const timer = setInterval(() => {
    if (install()) clearInterval(timer);
  }, 20);
  setTimeout(install, 0);
}
