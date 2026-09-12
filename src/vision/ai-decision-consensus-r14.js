import { activeHandMachine } from '../core/state-machine.js';

const d = typeof window !== 'undefined' ? window.__prcAIDecisionR14 : null;

function cardKey(cards) {
  return (cards || []).map((c) => `${String(c?.rank || '?').toUpperCase()}:${String(c?.suit || '?')}`).join(',');
}

function moneyKey(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '-';
}

function snapshotKey() {
  if (!d) return '';
  const actions = (d.actions || [])
    .map((a) => `${a?.type || '-'}:${moneyKey(a?.amount)}`)
    .sort()
    .join('|');
  return [
    Number(d.handId) || 0,
    cardKey(d.hero),
    cardKey(d.board),
    moneyKey(d.pot),
    actions,
    String(d.aggressorName || '').trim().toLowerCase(),
    moneyKey(d.aggressorCommitted),
    moneyKey(d.heroCommitted),
  ].join('#');
}

if (d && !d.__prcConsensusR14) {
  let rawTrusted = Boolean(d.trusted);
  let stableKey = '';
  let stableHits = 0;

  Object.defineProperty(d, 'trusted', {
    configurable: true,
    enumerable: true,
    get() {
      return Boolean(rawTrusted && (Number(d.rawStableFrames) >= 2 || stableHits >= 2));
    },
    set(value) {
      rawTrusted = Boolean(value);
      if (!rawTrusted) {
        stableHits = 0;
        stableKey = '';
        d.stableDecisionFrames = 0;
        return;
      }

      const key = snapshotKey();
      if (key && key === stableKey) stableHits++;
      else {
        stableKey = key;
        stableHits = key ? 1 : 0;
      }
      if (Number(d.rawStableFrames) >= 2) stableHits = Math.max(stableHits, 2);
      d.stableDecisionFrames = Math.max(stableHits, Number(d.rawStableFrames) || 0);
      d.rawTrusted = rawTrusted;
      d.consensusKey = stableKey;
      if (d.stableDecisionFrames < 2) d.trustReason = `Confirmando o mesmo snapshot da decisão (${d.stableDecisionFrames}/2).`;
    },
  });

  d.rawTrusted = rawTrusted;
  d.stableDecisionFrames = stableHits;
  d.consensusKey = stableKey;
  d.__prcConsensusR14 = true;

  window.addEventListener('prc:generation-change', () => {
    rawTrusted = false;
    stableKey = '';
    stableHits = 0;
    d.rawTrusted = false;
    d.stableDecisionFrames = 0;
    d.consensusKey = '';
  });

  setInterval(() => {
    if (Number(d.handId) !== Number(activeHandMachine?.handId)) {
      rawTrusted = false;
      stableKey = '';
      stableHits = 0;
      d.rawTrusted = false;
      d.stableDecisionFrames = 0;
      d.consensusKey = '';
    }
  }, 120);
}
