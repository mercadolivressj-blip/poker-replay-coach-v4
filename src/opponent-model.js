import { profileBoard } from './coach/board-profiler.js';

const AGGRO = new Set(['bet','raise','allin']);
const STREET_INDEX = { preflop: 0, flop: 1, turn: 2, river: 3 };

function fmtActor(name, seat) { return name || seat || 'Rival'; }
function sameActor(e, actorName, seatLabel) {
  if (actorName) return (e.actorName || null) === actorName;
  return (e.seatLabel || null) === seatLabel;
}

function sizingBucket(amount, potBefore) {
  if (!Number.isFinite(amount) || !Number.isFinite(potBefore) || potBefore <= 0) return null;
  const ratio = amount / potBefore;
  if (ratio <= 0.33) return { ratio, label: 'pequeno' };
  if (ratio <= 0.7) return { ratio, label: 'médio' };
  if (ratio <= 1.1) return { ratio, label: 'grande' };
  return { ratio, label: 'overbet' };
}

function shape(line) {
  const aggressive = line.filter((e) => AGGRO.has(e.action));
  const streets = new Set(aggressive.map((e) => e.street));
  const river = line.filter((e) => e.street === 'river');
  const turn = line.filter((e) => e.street === 'turn');
  const flop = line.filter((e) => e.street === 'flop');
  const riverRaise = river.some((e) => e.action === 'raise' || e.action === 'allin');
  const riverBet = river.some((e) => e.action === 'bet');
  const passiveBeforeRiver = [...flop, ...turn].some((e) => ['check','call'].includes(e.action)) &&
    ![...flop, ...turn].some((e) => AGGRO.has(e.action));
  const checkRaise = ['flop','turn','river'].some((street) => {
    const xs = line.filter((e) => e.street === street);
    return xs.some((e) => e.action === 'check') && xs.some((e) => ['raise','allin'].includes(e.action));
  });
  const tripleBarrel = ['flop','turn','river'].every((street) => aggressive.some((e) => e.street === street));
  const doubleBarrel = ['flop','turn'].every((street) => aggressive.some((e) => e.street === street));
  return { aggressive, streets, riverRaise, riverBet, passiveBeforeRiver, checkRaise, tripleBarrel, doubleBarrel };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function assessOpponent({ actorName = null, seatLabel = null, events = [], board = [], potBefore = null, priorAdjustment = 0 } = {}) {
  const actor = fmtActor(actorName, seatLabel);
  const line = events.filter((e) => sameActor(e, actorName, seatLabel));
  const boardInfo = profileBoard(board);
  const reasons = [];

  if (!line.length)
    return { actor, status: 'insufficient', label: 'SEM DADOS', bluffSignal: null, valueSignal: null, confidence: 0, reasons: ['Ainda não há ações suficientes desse rival no replay.'], board: boardInfo };

  const s = shape(line);
  const aggressive = s.aggressive;
  const lastAggro = aggressive[aggressive.length - 1] || null;
  if (!aggressive.length)
    return { actor, status: 'passive', label: 'LINHA PASSIVA', bluffSignal: 18, valueSignal: 32, confidence: 40, reasons: ['Nenhuma aposta/raise foi observada nessa linha.'], board: boardInfo };

  let bluff = 30 + clamp(priorAdjustment, -12, 12);
  let value = 45 - Math.min(5, Math.max(0, priorAdjustment / 3));
  const maxStreet = Math.max(...aggressive.map((e) => STREET_INDEX[e.street] ?? -1));

  if (s.streets.size >= 2) {
    bluff -= 5;
    value += 9;
    reasons.push('Agressão sustentada em mais de uma street mantém bastante valor na faixa.');
  }
  if (s.tripleBarrel) {
    value += 10;
    bluff += 3;
    reasons.push('Triple barrel é uma linha polar/forte; o padrão base é respeitar valor até surgir evidência de blefes naturais.');
  } else if (s.doubleBarrel) {
    value += 5;
    reasons.push('Double barrel mantém pressão e remove parte das mãos fracas da faixa.');
  }

  if (s.checkRaise) {
    value += 12;
    bluff += 4;
    reasons.push('Check/raise concentra a faixa: valor forte e alguns semi-blefes/blefes selecionados.');
  }

  if (maxStreet === 3) {
    bluff += 8;
    value += 7;
    reasons.push('Agressão no river é polar por natureza: valor e blefes ficam mais concentrados.');
  }

  if (s.riverRaise) {
    value += 17;
    bluff -= 2;
    reasons.push('Raise no river é tratado como value-dense por padrão; sem leitura do jogador, não presumimos overbluff.');
  } else if (s.riverBet && s.passiveBeforeRiver) {
    bluff += 7;
    value += 4;
    reasons.push('Agressão apenas no river após linha passiva amplia a polarização, mas não confirma blefe.');
  }

  const sizing = sizingBucket(lastAggro?.amount, potBefore);
  if (sizing) {
    reasons.push(`Sizing ${sizing.label}: ~${Math.round(sizing.ratio * 100)}% do pote.`);
    if (sizing.label === 'overbet') {
      bluff += 9;
      value += 11;
      reasons.push('Overbet comprime a faixa em extremos: mãos muito fortes e blefes escolhidos.');
    } else if (sizing.label === 'grande') {
      value += 5;
      bluff += 2;
    } else if (sizing.label === 'pequeno' && lastAggro?.street === 'river') {
      bluff -= 5;
      value += 7;
      reasons.push('Sizing pequeno no river comporta mais thin value e block bets; reduzimos o prior de blefe.');
    }
  } else if (Number.isFinite(lastAggro?.amount)) {
    reasons.push(`Último sizing observado: ${Math.round(lastAggro.amount)}.`);
  }

  const riverChange = boardInfo.changes.river;
  const missedFrontdoorFlush = board.length === 5 && boardInfo.twoToneFlop && boardInfo.dominantSuitCount === 2;
  if (missedFrontdoorFlush) {
    bluff += 9;
    reasons.push('O flush draw principal do flop não completou: existem blefes naturais de draws que erraram.');
  }
  if (riverChange?.brick) {
    bluff += 4;
    reasons.push('River brick preserva draws perdidos e cria candidatos naturais a blefe.');
  }
  if (riverChange?.flushPressureUp || riverChange?.straightPressureUp) {
    value += 9;
    bluff -= 3;
    reasons.push('O river completa/fortalece draws relevantes, aumentando combinações naturais de valor.');
  }
  if (riverChange?.pairedBoard) {
    value += 5;
    reasons.push('River pareando a mesa altera a distribuição de valor e fortalece algumas linhas de trips/full house.');
  }
  if (boardInfo.fourFlushBoard || boardInfo.straightMadeOnBoard) {
    bluff += 3;
    value += 4;
    reasons.push('Board extremo aumenta polarização e importância de blockers.');
  }

  bluff = clamp(bluff, 5, 88);
  value = clamp(value, 10, 94);
  const confidence = clamp(36 + line.length * 5 + (sizing ? 8 : 0) + (board.length >= 3 ? 5 : 0) + (s.riverRaise || s.tripleBarrel ? 5 : 0), 0, 82);

  let status = 'inconclusive';
  let label = 'INCONCLUSIVO';
  if (maxStreet === 3 && bluff >= 50 && value >= 58 && Math.abs(value - bluff) < 24) {
    status = 'polar'; label = 'LINHA POLARIZADA';
  } else if (bluff >= 62 && bluff >= value + 6) {
    status = 'possible-bluff'; label = 'BLEFE PLAUSÍVEL';
  } else if (value >= 64 && value >= bluff + 10) {
    status = 'value-leaning'; label = 'VALOR PROVÁVEL';
  }

  return {
    actor,
    status,
    label,
    bluffSignal: bluff,
    valueSignal: value,
    confidence,
    reasons,
    lineShape: {
      tripleBarrel: s.tripleBarrel,
      doubleBarrel: s.doubleBarrel,
      riverRaise: s.riverRaise,
      checkRaise: s.checkRaise,
    },
    board: boardInfo,
    disclaimer: 'Cartas do rival são ocultas; isto é inferência de range baseada apenas no replay.',
  };
}
