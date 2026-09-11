import { boardTexture } from './strategy.js';

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

export function assessOpponent({ actorName = null, seatLabel = null, events = [], board = [], potBefore = null } = {}) {
  const actor = fmtActor(actorName, seatLabel);
  const line = events.filter((e) => sameActor(e, actorName, seatLabel));
  const aggressive = line.filter((e) => AGGRO.has(e.action));
  const lastAggro = aggressive[aggressive.length - 1] || null;
  const streets = new Set(aggressive.map((e) => e.street));
  const reasons = [];

  if (!line.length)
    return { actor, status: 'insufficient', label: 'SEM DADOS', bluffSignal: null, valueSignal: null, confidence: 0, reasons: ['Ainda não há ações suficientes desse rival no replay.'] };
  if (!aggressive.length)
    return { actor, status: 'passive', label: 'LINHA PASSIVA', bluffSignal: 20, valueSignal: 35, confidence: 42, reasons: ['Nenhuma aposta/raise foi observada nessa linha.'] };

  let bluff = 34;
  let value = 46;
  const maxStreet = Math.max(...aggressive.map((e) => STREET_INDEX[e.street] ?? -1));

  if (streets.size >= 2) {
    bluff -= 7;
    value += 10;
    reasons.push('Agressão mantida em múltiplas streets sustenta mais combinações de valor.');
  }
  if (streets.size >= 3) {
    bluff -= 4;
    value += 7;
    reasons.push('Tripla agressão é uma linha forte; blefes existem, mas exigem contexto adicional.');
  }
  if (maxStreet === 3) {
    bluff += 12;
    value += 8;
    reasons.push('Agressão no river é polar: tende a concentrar valor forte e blefes.');
  }

  const prev = line[line.length - 2];
  if (lastAggro?.street === 'river' && prev && ['check','call'].includes(prev.action)) {
    bluff += 10;
    reasons.push('Mudança de linha passiva para agressão no river aumenta a polarização.');
  }

  const sizing = sizingBucket(lastAggro?.amount, potBefore);
  if (sizing) {
    reasons.push(`Sizing ${sizing.label}: ~${Math.round(sizing.ratio * 100)}% do pote.`);
    if (sizing.label === 'overbet') { bluff += 9; value += 10; reasons.push('Overbet comprime a faixa em extremos: valor muito forte ou blefe.'); }
    else if (sizing.label === 'pequeno' && lastAggro?.street === 'river') { bluff -= 5; value += 5; reasons.push('Sizing pequeno no river costuma comportar mais thin value e bloqueios.'); }
  } else if (Number.isFinite(lastAggro?.amount)) {
    reasons.push(`Último sizing observado: ${Math.round(lastAggro.amount)}.`);
  }

  if (board.length >= 3) reasons.push(`Textura atual: ${boardTexture(board)}.`);

  bluff = Math.max(5, Math.min(85, bluff));
  value = Math.max(10, Math.min(90, value));
  const confidence = Math.min(76, 38 + line.length * 5 + (sizing ? 8 : 0) + (board.length >= 3 ? 5 : 0));

  let status = 'inconclusive';
  let label = 'INCONCLUSIVO';
  if (maxStreet === 3 && bluff >= 55 && value >= 55) { status = 'polar'; label = 'LINHA POLARIZADA'; }
  else if (bluff >= 58 && bluff >= value + 5) { status = 'possible-bluff'; label = 'BLEFE POSSÍVEL'; }
  else if (value >= 62 && value >= bluff + 12) { status = 'value-leaning'; label = 'VALOR PROVÁVEL'; }

  return {
    actor,
    status,
    label,
    bluffSignal: bluff,
    valueSignal: value,
    confidence,
    reasons,
    disclaimer: 'Cartas do rival são ocultas; isto é inferência de range, nunca leitura da mão real.',
  };
}
