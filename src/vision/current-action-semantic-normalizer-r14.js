import { activeHandMachine } from '../core/state-machine.js';

const diagnostics = {
  enabled: true,
  normalizations: 0,
  lastBefore: '',
  lastAfter: '',
};

if (typeof window !== 'undefined') window.__prcCurrentActionSemanticNormalizerR14 = diagnostics;

function signature(actions = []) {
  return (actions || []).map((action) => `${action?.type || ''}:${Number.isFinite(action?.amount) ? Number(action.amount) : '-'}`).join('|');
}

function normalize(actions = []) {
  if (!Array.isArray(actions) || actions.length < 2) return actions;
  const types = new Set(actions.map((action) => String(action?.type || '')).filter(Boolean));
  const freeAction = types.has('check') && !types.has('call');
  const facingPrice = types.has('call') || types.has('fold');

  let changed = false;
  const next = actions.map((action) => {
    const type = String(action?.type || '');
    if (freeAction && type === 'raise') {
      changed = true;
      return { ...action, type: 'bet' };
    }
    if (facingPrice && type === 'bet') {
      changed = true;
      return { ...action, type: 'raise' };
    }
    return action;
  });

  return changed ? next : actions;
}

function tick() {
  const machine = activeHandMachine;
  if (!machine?.state || machine.handId <= 0) return;
  const current = Array.isArray(machine.state.actions) ? machine.state.actions : [];
  if (current.length < 2) return;
  const next = normalize(current);
  if (next === current) return;

  const before = signature(current);
  const after = signature(next);
  if (before === after) return;

  diagnostics.lastBefore = before;
  diagnostics.lastAfter = after;
  if (machine.setActions(next, machine.handId)) diagnostics.normalizations++;
}

if (typeof window !== 'undefined') {
  setInterval(tick, 24);
  setTimeout(tick, 0);
}

export { normalize as normalizeCurrentActionSemantics };
