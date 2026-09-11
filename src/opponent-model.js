import { analyzeMadeHand, analyzeDraws, boardTexture } from './strategy.js';

const AGGRO = new Set(['bet','raise','allin']);

function fmtActor(name, seat) { return name || seat || 'Rival'; }

export function assessOpponent({ actorName = null, seatLabel = null, events = [], board = [], revealedCards = null } = {}) {
  const actor = fmtActor(actorName, seatLabel);
  const line = events.filter((e) => (e.actorName || null) === actorName || (!actorName && (e.seatLabel || null) === seatLabel));
  const aggressive = line.filter((e) => AGGRO.has(e.action));
  const lastAggro = aggressive[aggressive.length - 1] || null;
  const streets = new Set(aggressive.map((e) => e.street));
  const reasons = [];

  if (Array.isArray(revealedCards) && revealedCards.length === 2 && board.length >= 3) {
    const made = analyzeMadeHand(revealedCards, board);
    const draws = analyzeDraws(revealedCards, board);
    reasons.push(`${actor} mostrou ${revealedCards.map((c) => c.rank).join('')} (${made.name}).`);
    if (lastAggro && lastAggro.street === 'river' && made.tier <= 1) {
      return { actor, status: 'confirmed-bluff', label: 'BLEFE CONFIRMADO', bluffSignal: 100, confidence: 96, reasons };
    }
    if (lastAggro && lastAggro.street === 'river' && made.tier <= 2 && !draws.flushDraw && !draws.straightDraw) {
      reasons.push('Agressão no river com mão feita fraca: pode ser thin value ou blefe transformado.');
      return { actor, status: 'polar', label: 'LINHA POLARIZADA', bluffSignal: 65, confidence: 82, reasons };
    }
    reasons.push('Showdown observado: a análise usa cartas realmente reveladas, não uma suposição.');
    return { actor, status: 'revealed', label: 'MÃO REVELADA', bluffSignal: made.tier <= 2 ? 35 : 10, confidence: 94, reasons };
  }

  if (!line.length) return { actor, status: 'insufficient', label: 'SEM DADOS', bluffSignal: null, confidence: 0, reasons: ['Ainda não há ações suficientes desse rival no replay.'] };
  if (!aggressive.length) return { actor, status: 'passive', label: 'LINHA PASSIVA', bluffSignal: 20, confidence: 50, reasons: ['Nenhuma aposta/raise observado nessa linha.'] };

  let signal = 35;
  if (streets.size >= 2) { signal -= 8; reasons.push('Agressão em múltiplas streets representa força com mais frequência.'); }
  if (lastAggro?.street === 'river') { signal += 12; reasons.push('Agressão no river é polar: valor forte ou blefe.'); }
  const prev = line[line.length - 2];
  if (lastAggro?.street === 'river' && prev && ['check','call'].includes(prev.action)) { signal += 10; reasons.push('Mudança de linha passiva para agressão tardia aumenta a polarização.'); }
  if (Number.isFinite(lastAggro?.amount)) reasons.push(`Último sizing observado: ${Math.round(lastAggro.amount)}.`);
  if (board.length >= 3) reasons.push(`Textura do board: ${boardTexture(board)}.`);
  signal = Math.max(5, Math.min(85, signal));
  return { actor, status: signal >= 58 ? 'possible-bluff' : 'inconclusive', label: signal >= 58 ? 'BLEFE POSSÍVEL' : 'INCONCLUSIVO', bluffSignal: signal, confidence: Math.min(72, 42 + line.length * 5), reasons };
}
