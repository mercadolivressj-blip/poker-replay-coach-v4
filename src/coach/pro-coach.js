import { recommend, analyzeMadeHand, analyzeDraws } from '../strategy.js';
import { assessOpponent } from '../opponent-model.js';
import { profileBoard, heroBlockers } from './board-profiler.js';

const find = (actions, type) => (actions || []).find((a) => a.type === type);
const has = (actions, type) => !!find(actions, type);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function decisionMath(state, potBefore = null, events = []) {
  const call = find(state.actions, 'call')?.amount ?? null;
  const shownPot = Number.isFinite(state.pot) ? state.pot : null;
  const potOdds = Number.isFinite(call) && Number.isFinite(shownPot) && call > 0
    ? call / (shownPot + call)
    : null;
  const lastBet = [...events].reverse().find((e) => ['bet','raise','allin'].includes(e.action) && Number.isFinite(e.amount));
  const betSize = lastBet?.amount ?? call;
  const mdf = Number.isFinite(potBefore) && potBefore > 0 && Number.isFinite(betSize) && betSize > 0
    ? potBefore / (potBefore + betSize)
    : null;
  return {
    call,
    shownPot,
    potOdds,
    breakEvenBluffCatch: potOdds,
    mdf,
    betSize: Number.isFinite(betSize) ? betSize : null,
  };
}

function estimatedBluffShare(opponent, blockers) {
  if (!Number.isFinite(opponent?.bluffSignal) || !Number.isFinite(opponent?.valueSignal)) return null;
  const sum = opponent.bluffSignal + opponent.valueSignal;
  if (sum <= 0) return null;
  let share = opponent.bluffSignal / sum;
  share += (blockers?.valueBlock || 0) / 300;
  share -= (blockers?.bluffBlock || 0) / 360;
  return clamp(share, 0.05, 0.68);
}

function mixLabel(share) {
  if (!Number.isFinite(share)) return 'desconhecido';
  if (share < 0.25) return 'fortemente orientado a valor';
  if (share < 0.38) return 'mais valor que blefe';
  if (share <= 0.54) return 'polar / misto';
  return 'blefes plausíveis em frequência relevante';
}

function pct(n) { return `${Math.round(n * 100)}%`; }

export function buildProCoachReport({
  state,
  events = [],
  actorName = null,
  seatLabel = null,
  potBefore = null,
  opponentStats = null,
} = {}) {
  const safeState = state || { hero: [], board: [], street: 'preflop', pot: null, actions: [] };
  const base = recommend(safeState);
  const board = profileBoard(safeState.board || []);
  const blockers = heroBlockers(safeState.hero || [], safeState.board || []);
  const priorAdjustment = opponentStats?.bluffPriorAdjustment || 0;
  const opponent = assessOpponent({ actorName, seatLabel, events, board: safeState.board || [], potBefore, priorAdjustment });
  const math = decisionMath(safeState, potBefore, events);
  const bluffShare = estimatedBluffShare(opponent, blockers);
  const rangeMix = { bluffShare, label: mixLabel(bluffShare) };

  const output = {
    ...base,
    details: [...(base.details || [])],
    coachLevel: 'pro-v1',
    opponent,
    opponentStats,
    boardProfile: board,
    blockers,
    math,
    rangeMix,
    inferenceOnly: true,
  };

  if (opponentStats?.style && opponentStats.style !== 'unknown')
    output.details.push(`Tendência observada: ${opponentStats.style} (${opponentStats.hands} mãos).`);
  else if (opponentStats?.hands)
    output.details.push(`Tendência do rival: amostra pequena (${opponentStats.hands} mãos).`);

  if (Number.isFinite(bluffShare) && opponent.confidence >= 50)
    output.details.push(`Mix inferido do range: ${rangeMix.label} (~${pct(bluffShare)} de blefes no modelo heurístico).`);
  if (Number.isFinite(math.potOdds)) output.details.push(`Equidade mínima para pagar: ~${pct(math.potOdds)}.`);
  for (const feature of blockers.features.slice(0, 2)) output.details.push(`Blocker: ${feature}.`);

  if (safeState.street === 'preflop' || !safeState.hero?.length || !safeState.board?.length) return output;

  const made = analyzeMadeHand(safeState.hero, safeState.board);
  const draws = analyzeDraws(safeState.hero, safeState.board);
  const facingBet = has(safeState.actions, 'call') && !has(safeState.actions, 'check');
  if (!facingBet) return output;

  // River bluff-catcher decisions are where opponent range context matters most.
  if (safeState.street === 'river' && Number.isFinite(bluffShare) && Number.isFinite(math.breakEvenBluffCatch) && opponent.confidence >= 55) {
    const bluffCatcher = made.tier >= 2 && made.tier < 3;
    const weakShowdown = made.tier < 2;
    const edge = bluffShare - math.breakEvenBluffCatch;

    if (weakShowdown && has(safeState.actions, 'fold')) {
      output.decision = 'DESISTIR';
      output.reason = 'Sua mão não é um bluff-catcher confiável contra a faixa agressiva inferida.';
      output.confidence = Math.max(output.confidence || 0, 74);
      return output;
    }

    if (bluffCatcher) {
      const dangerousRiver = board.changes.river?.flushPressureUp || board.changes.river?.straightPressureUp;
      const blockerBonus = blockers.valueBlock - blockers.bluffBlock;
      const adjustedEdge = edge + blockerBonus / 500 - (dangerousRiver ? 0.04 : 0);

      if (adjustedEdge >= 0.08 && has(safeState.actions, 'call')) {
        output.decision = 'PAGAR';
        output.reason = 'Bluff-catcher com preço favorável: o range inferido contém blefes suficientes para justificar o call.';
        output.confidence = clamp(Math.max(62, opponent.confidence - 4), 0, 78);
        return output;
      }
      if (adjustedEdge <= -0.05 && has(safeState.actions, 'fold')) {
        output.decision = 'DESISTIR';
        output.reason = 'O preço exige blefes demais para a faixa inferida; o fold é mais disciplinado.';
        output.confidence = clamp(Math.max(66, opponent.confidence - 2), 0, 80);
        return output;
      }
      output.reason = `${output.reason} Spot de bluff-catcher próximo do limite; range e blockers não dão margem suficiente para uma conclusão mais forte.`;
    }
  }

  if ((draws.flushDraw || draws.straightDraw) && safeState.street !== 'river' && Number.isFinite(math.potOdds)) {
    output.details.push('Draw do Hero deve ser comparado ao preço e ao stack efetivo; implied odds ainda não são assumidas.');
  }

  return output;
}
