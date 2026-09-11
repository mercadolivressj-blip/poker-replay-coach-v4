import { HandMachine, activeHandMachine } from '../core/state-machine.js';
import { PotConsensus } from '../detectors/pot.js';

const PATCH = Symbol.for('prc.money.r13');

export function normalizeAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000) / 1000;
}

export function amountTolerance(value, ratio = 0.006) {
  const n = Math.abs(Number(value) || 0);
  return Math.max(0.005, n * ratio);
}

export function formatAmount(value) {
  const n = normalizeAmount(value);
  if (n === null) return '—';
  const fractional = Math.abs(n - Math.round(n)) > 1e-9;
  return new Intl.NumberFormat('pt-BR', fractional
    ? { minimumFractionDigits: 2, maximumFractionDigits: 3 }
    : { maximumFractionDigits: 0 }).format(n);
}

if (!PotConsensus.prototype[PATCH]) {
  Object.defineProperty(PotConsensus.prototype, PATCH, { value: true });
  PotConsensus.prototype.observe = function observeMoney(value) {
    const n = normalizeAmount(value);
    if (n === null) return null;
    if (this.value !== null && n < this.value * 0.72) return null;

    if (this.pending !== null && Math.abs(this.pending - n) <= amountTolerance(n)) this.hits++;
    else {
      this.pending = n;
      this.hits = 1;
    }

    if (this.hits < 2) return null;
    if (this.value !== null && n + amountTolerance(this.value) < this.value) return null;
    this.value = n;
    return n;
  };
}

if (!HandMachine.prototype[PATCH]) {
  Object.defineProperty(HandMachine.prototype, PATCH, { value: true });

  HandMachine.prototype.setPot = function setMoneyPot(value, handId) {
    if (handId !== this.handId) return false;
    const n = normalizeAmount(value);
    if (n === null) return false;
    this.state.pot = n;
    return true;
  };

  HandMachine.prototype.observePotValue = function observeMoneyPot(value, now = performance.now()) {
    const n = normalizeAmount(value);
    if (n === null || this.state.pot === null || this.state.board.length > 0) {
      this.potResetPending = null;
      this.potResetHits = 0;
      return { newHand: false, reason: null };
    }

    const old = normalizeAmount(this.state.pot);
    if (old === null) return { newHand: false, reason: null };
    const absoluteFloor = old < 1 ? 0.02 : old < 10 ? 0.10 : 2;
    const materialDrop = n <= old * 0.65 && old - n >= Math.max(absoluteFloor, old * 0.25);
    if (!materialDrop) {
      this.potResetPending = null;
      this.potResetHits = 0;
      return { newHand: false, reason: null };
    }

    this.markTransitionHint('pot-drop', now);
    const close = this.potResetPending !== null && Math.abs(this.potResetPending - n) <= Math.max(0.005, n * 0.01);
    if (close) this.potResetHits++;
    else {
      this.potResetPending = n;
      this.potResetHits = 1;
    }

    if (this.potResetHits < 2 || now - this.state.startedAt <= 150) return { newHand: false, reason: null };
    this.newHand('pot-reset', now);
    this.adoptNextHero = true;
    this.potResetPending = null;
    this.potResetHits = 0;
    return { newHand: true, reason: 'pot-reset' };
  };
}

let syncing = false;
function syncMoneyUi() {
  if (syncing || typeof document === 'undefined') return;
  const machine = activeHandMachine;
  if (!machine) return;
  syncing = true;
  try {
    const potEl = document.getElementById('potValue');
    if (potEl && Number.isFinite(machine.state.pot)) {
      const wanted = formatAmount(machine.state.pot);
      if (potEl.textContent !== wanted) potEl.textContent = wanted;
    }

    const actionBox = document.getElementById('actions');
    const pills = actionBox ? [...actionBox.querySelectorAll('.action-pill')] : [];
    (machine.state.actions || []).forEach((action, i) => {
      const pill = pills[i];
      if (!pill) return;
      const amount = Number.isFinite(action.amount) ? ` ${formatAmount(action.amount)}` : '';
      const wanted = `${String(action.type || '').toUpperCase()}${amount}`;
      if (pill.textContent !== wanted) pill.textContent = wanted;
    });
  } finally {
    syncing = false;
  }
}

if (typeof document !== 'undefined') {
  const target = document.querySelector('.coach-card') || document.body;
  if (target && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(syncMoneyUi);
    observer.observe(target, { subtree: true, childList: true, characterData: true });
  }
  setInterval(syncMoneyUi, 90);
  setTimeout(syncMoneyUi, 0);
}
