import { activeHandMachine } from '../core/state-machine.js';
import { activeTableStateTracker } from '../core/table-state-tracker.js';
import { classifyPreflopContext } from '../core/preflop-context-r14.js';

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function cardId(card) {
  return card?.rank && card?.suit ? `${String(card.rank).toUpperCase()}:${String(card.suit)}` : '?';
}

function exactCards(a, b) {
  return Array.isArray(a)
    && Array.isArray(b)
    && a.length === b.length
    && a.map(cardId).join(',') === b.map(cardId).join(',');
}

function closeMoney(a, b) {
  return Number.isFinite(a)
    && Number.isFinite(b)
    && Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.04);
}

function fresh(source, at, floor = 5200) {
  const seen = Number(source?.lastSeenAt) || 0;
  if (!seen) return false;
  const latency = Math.max(0, Number(source?.lastLatencyMs) || 0);
  const windowMs = Math.max(floor, Math.min(10000, latency * 2 + 2200));
  return at - seen <= windowMs;
}

function normalizeActions(actions = []) {
  const seen = new Map();
  for (const action of actions || []) {
    const type = String(action?.type || '');
    if (!type) continue;
    const amount = Number.isFinite(action?.amount) ? Number(action.amount) : null;
    const existing = seen.get(type);
    if (!existing || (!Number.isFinite(existing.amount) && Number.isFinite(amount))) seen.set(type, { type, amount });
  }
  return [...seen.values()];
}

function actionTypes(actions = []) {
  return normalizeActions(actions).map((action) => action.type).sort();
}

function sameActionTypes(a, b) {
  const aa = actionTypes(a);
  const bb = actionTypes(b);
  return aa.length >= 2 && aa.length === bb.length && aa.every((type, index) => type === bb[index]);
}

function mergeActions(local = [], fast = []) {
  const out = new Map(normalizeActions(local).map((action) => [action.type, { ...action }]));
  for (const action of normalizeActions(fast)) {
    const current = out.get(action.type);
    if (!current) out.set(action.type, { ...action });
    else if (!Number.isFinite(current.amount) && Number.isFinite(action.amount)) current.amount = action.amount;
  }
  return [...out.values()];
}

function completeCards(cards, count) {
  return Array.isArray(cards)
    && cards.length === count
    && cards.every((card) => card?.rank && card?.suit);
}

function expectedBoardCount(street) {
  return street === 'flop' ? 3 : street === 'turn' ? 4 : street === 'river' ? 5 : 0;
}

function fail(reason, extra = {}) {
  return { ready: false, confidence: 0, reason, ...extra };
}

export function evaluateDecisionCore({ machine, authority, fast, full, table, at = nowMs() } = {}) {
  if (!machine || machine.handId <= 0) return fail('A mão atual ainda não foi iniciada.');

  const state = machine.state || {};
  const hero = Array.isArray(state.hero) ? state.hero : [];
  if (!authority?.manualOnly || !authority?.heroLocked || Number(authority.handId) !== Number(machine.handId) || !completeCards(hero, 2)) {
    return fail('Aguardando as duas cartas manuais do Hero.');
  }

  const board = Array.isArray(state.board) ? state.board : [];
  const expected = expectedBoardCount(state.street);
  if (!completeCards(board, expected)) return fail('Board/street atual ainda não está completo.');
  if (!Number.isFinite(Number(state.pot)) || Number(state.pot) <= 0) return fail('Pote atual ainda não foi confirmado.');

  if (!fast || Number(fast.handId) !== Number(machine.handId) || !fresh(fast, at, 4800)) {
    return fail('A ação atual ainda não tem uma leitura rápida recente.');
  }
  if (Number(fast.confidence) < 0.84 || Number(fast.boardConfidence) < 0.76 || Number(fast.potConfidence) < 0.80 || Number(fast.actionsConfidence) < 0.78) {
    return fail('A leitura atual ainda está abaixo da confiança mínima do núcleo.');
  }
  if (!exactCards(board, fast.board || [])) return fail('Board lógico e leitura atual estão divergindo.');
  if (!Number.isFinite(Number(fast.pot)) || !closeMoney(Number(state.pot), Number(fast.pot))) return fail('Pote lógico e leitura atual estão divergindo.');

  const localActions = normalizeActions(state.actions || []);
  const fastActions = normalizeActions(fast.actions || []);
  if (localActions.length < 2 || fastActions.length < 2 || !sameActionTypes(localActions, fastActions)) {
    return fail('Os botões físicos e a leitura atual ainda não concordam.');
  }
  const actions = mergeActions(localActions, fastActions);
  const call = actions.find((action) => action.type === 'call');
  if (call && !Number.isFinite(call.amount)) return fail('O valor atual do call ainda não foi confirmado.');
  const missingAggressiveAmount = actions.some((action) => ['bet','raise'].includes(action.type) && !Number.isFinite(action.amount));
  if (missingAggressiveAmount) return fail('O tamanho atual da aposta/raise ainda não foi confirmado.');

  if (!table || Number(table.handId) !== Number(machine.handId)) return fail('Jogadores/posições ainda não pertencem à mão atual.');
  const tableAge = Number.isFinite(Number(table.observedAt)) ? at - Number(table.observedAt) : Infinity;
  if (tableAge > 9000 || Number(table.confidence) < 0.62) return fail('A leitura dos jogadores/posições está velha.');

  const seats = Array.isArray(table.seats) ? table.seats : [];
  const heroSeat = seats.find((seat) => seat?.hero);
  if (!heroSeat) return fail('A posição do Hero ainda não está ligada à mesa.');
  const activeOpponents = seats.filter((seat) => !seat?.hero && seat?.folded !== true && (seat?.actorName || Number.isFinite(seat?.stack) || Number.isFinite(seat?.committed)));
  if (!activeOpponents.length) return fail('Ainda não há adversários ativos confirmados.');

  const heroPosition = table.heroPosition || heroSeat.position || null;
  if (state.street === 'preflop' && !heroPosition) return fail('A posição pré-flop do Hero ainda não foi confirmada.');

  const heroStack = Number.isFinite(heroSeat.stack) ? Number(heroSeat.stack) : null;
  const knownOpponentStacks = activeOpponents.filter((seat) => Number.isFinite(seat.stack));
  if (!Number.isFinite(heroStack) || !knownOpponentStacks.length) return fail('Stacks efetivos ainda não estão confirmados.');

  const aggressorName = typeof fast.aggressorName === 'string' && fast.aggressorName.trim() ? fast.aggressorName.trim() : null;
  const aggressorSeat = aggressorName
    ? activeOpponents.find((seat) => String(seat.actorName || '').trim().toLowerCase() === aggressorName.toLowerCase()) || null
    : null;
  const referenceOpponentStack = Number.isFinite(aggressorSeat?.stack)
    ? Number(aggressorSeat.stack)
    : Math.min(...knownOpponentStacks.map((seat) => Number(seat.stack)));
  const effectiveStack = Math.min(heroStack, referenceOpponentStack);

  let fullAgreement = false;
  if (full && Number(full.handId) === Number(machine.handId) && fresh(full, at, 6500)) {
    const fullBoardReliable = Number(full.boardConfidence) >= 0.72;
    const fullPotReliable = Number(full.potConfidence) >= 0.74;
    if (fullBoardReliable && !exactCards(board, full.board || [])) return fail('As duas fontes estão divergindo no board atual.');
    if (fullPotReliable && Number.isFinite(Number(full.pot)) && !closeMoney(Number(state.pot), Number(full.pot))) return fail('As duas fontes estão divergindo no pote atual.');
    fullAgreement = (!fullBoardReliable || exactCards(board, full.board || []))
      && (!fullPotReliable || !Number.isFinite(Number(full.pot)) || closeMoney(Number(state.pot), Number(full.pot)));
  }

  const preflopContext = state.street === 'preflop'
    ? classifyPreflopContext({
        seats,
        heroCommitted: Number.isFinite(fast.heroCommitted) ? Number(fast.heroCommitted) : heroSeat.committed,
        proposedAggressorName: aggressorName,
        proposedAggressorCommitted: Number.isFinite(fast.aggressorCommitted) ? Number(fast.aggressorCommitted) : null,
      })
    : null;

  const weighted = (
    Number(fast.confidence) * 0.28
    + Number(fast.actionsConfidence) * 0.22
    + Number(fast.boardConfidence) * 0.16
    + Number(fast.potConfidence) * 0.14
    + Math.max(0, Math.min(1, Number(table.confidence) || 0)) * 0.20
  );
  let confidence = Math.round(60 + weighted * 38);
  if (fullAgreement) confidence += 2;
  if (activeOpponents.some((seat) => !Number.isFinite(seat.stack))) confidence -= 4;
  if (state.street !== 'preflop' && table.dealerSeat == null && !heroPosition) confidence -= 3;
  if (activeOpponents.length > 1) confidence -= Math.min(6, (activeOpponents.length - 1) * 2);
  confidence = Math.max(70, Math.min(95, confidence));

  return {
    ready: true,
    confidence,
    reason: fullAgreement
      ? 'Estado atual confirmado pelo núcleo + segunda fonte pública.'
      : 'Estado atual confirmado pelo núcleo mínimo.',
    handId: machine.handId,
    street: state.street,
    hero: hero.map((card) => ({ ...card })),
    board: board.map((card) => ({ ...card })),
    pot: Number(state.pot),
    actions,
    seats: seats.map((seat) => ({ ...seat })),
    activeOpponents: activeOpponents.map((seat) => ({ ...seat })),
    activeOpponentCount: activeOpponents.length,
    heroPosition,
    dealerSeat: table.dealerSeat ?? null,
    heroStack,
    effectiveStack,
    aggressorName,
    aggressorKnown: Boolean(aggressorSeat),
    aggressorCommitted: Number.isFinite(fast.aggressorCommitted) ? Number(fast.aggressorCommitted) : null,
    heroCommitted: Number.isFinite(fast.heroCommitted) ? Number(fast.heroCommitted) : (Number.isFinite(heroSeat.committed) ? Number(heroSeat.committed) : null),
    preflopMode: preflopContext?.mode || null,
    preflopContext,
    fullAgreement,
    tableAge,
  };
}

export function currentDecisionCoreEvidence() {
  if (typeof window === 'undefined') return fail('Núcleo indisponível fora do navegador.');
  return evaluateDecisionCore({
    machine: activeHandMachine,
    authority: window.__prcManualHeroAuthorityR14,
    fast: window.__prcAIDecisionR14,
    full: window.__prcAIStateR14,
    table: activeTableStateTracker?.latest,
    at: nowMs(),
  });
}

if (typeof window !== 'undefined') {
  window.__prcDecisionCoreR14 = {
    enabled: true,
    get evidence() { return currentDecisionCoreEvidence(); },
  };
}

export { exactCards, closeMoney, normalizeActions, sameActionTypes };
