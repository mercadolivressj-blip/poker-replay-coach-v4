import { HandMachine } from './state-machine.js';
import { HeroCardConsensus } from './hero-card-consensus.js';
import { ReasoningBrain } from '../coach/reasoning-brain.js';

const heroConsensusByMachine = new WeakMap();
const originalSetHero = HandMachine.prototype.setHero;

function consensusFor(machine) {
  let consensus = heroConsensusByMachine.get(machine);
  if (!consensus) {
    consensus = new HeroCardConsensus();
    heroConsensusByMachine.set(machine, consensus);
  }
  if (consensus.handId !== machine.handId) consensus.resetHand(machine.handId);
  return consensus;
}

function sourceOf(cards = []) {
  const sources = cards.map((c) => String(c?.source || ''));
  if (sources.some((s) => s.startsWith('vision'))) return 'teacher';
  if (sources.some((s) => s.includes('ocr'))) return 'ocr';
  return 'local';
}

HandMachine.prototype.setHero = function guardedSetHero(cards, handId) {
  if (handId !== this.handId) return false;
  const consensus = consensusFor(this);
  const result = consensus.observe(cards, { handId, source: sourceOf(cards) });
  if (!result.accepted || !result.cards) return false;
  return originalSetHero.call(this, result.cards, handId);
};

const originalResetSession = HandMachine.prototype.resetSession;
HandMachine.prototype.resetSession = function guardedResetSession(...args) {
  const out = originalResetSession.apply(this, args);
  heroConsensusByMachine.delete(this);
  return out;
};

const originalBrainRead = ReasoningBrain.prototype.read;
const originalBrainResetSession = ReasoningBrain.prototype.resetSession;

ReasoningBrain.prototype.resetSession = function guardedBrainResetSession(...args) {
  const out = originalBrainResetSession.apply(this, args);
  this.hardDisabled = false;
  this.hardDisabledReason = null;
  return out;
};

ReasoningBrain.prototype.read = async function guardedBrainRead(payload) {
  if (this.hardDisabled) return null;
  const out = await originalBrainRead.call(this, payload);
  const err = String(this.lastError || '');
  if (/not configured|auth required|HTTP\s*(401|501)/i.test(err)) {
    this.hardDisabled = true;
    this.hardDisabledReason = err;
    this.controller?.abort();
    this.controller = null;
    this.busy = false;
  }
  return out;
};

export function heroConsensusSnapshot(machine) {
  return heroConsensusByMachine.get(machine)?.snapshot() || null;
}
