export const VISION_STATE_VERSION = 'vision-state-v1';
export const VISION_SOURCE = 'lovable-vision-v1';

const CARD_RE = /^[2-9TJQKA][hdcs]$/;
const PRESENCE = new Set(['present', 'absent', 'uncertain']);
const ACTIONS = new Set(['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALLIN']);

const cleanCards = (value, max) => {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const card = typeof raw === 'string' ? raw.trim() : '';
    if (!CARD_RE.test(card) || out.includes(card)) continue;
    out.push(card);
    if (out.length >= max) break;
  }
  return out;
};

const cleanActions = (value) => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim().toUpperCase())
    .filter((x) => ACTIONS.has(x)))];
};

const nullableText = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const nullablePresence = (value) => PRESENCE.has(value) ? value : null;

export function normalizeVisionState(raw, now = Date.now()) {
  const confidence = Number.isFinite(raw?.confidence)
    ? Math.max(0, Math.min(1, Number(raw.confidence)))
    : 0;

  return {
    version: VISION_STATE_VERSION,
    heroCards: cleanCards(raw?.heroCards, 2),
    heroPresence: nullablePresence(raw?.heroPresence),
    board: cleanCards(raw?.board, 5),
    boardPresence: nullablePresence(raw?.boardPresence),
    pot: nullableText(raw?.pot),
    heroStack: nullableText(raw?.heroStack),
    blinds: nullableText(raw?.blinds),
    legalActions: cleanActions(raw?.legalActions),
    toCall: nullableText(raw?.toCall),
    confidence,
    readerModel: nullableText(raw?.readerModel),
    source: VISION_SOURCE,
    observedAt: now,
  };
}

export function assertVisionStateV1(state) {
  if (!state || state.version !== VISION_STATE_VERSION)
    throw new Error('VISION_STATE_VERSION_MISMATCH');
  if (!Array.isArray(state.heroCards) || state.heroCards.some((c) => !CARD_RE.test(c)))
    throw new Error('VISION_STATE_INVALID_HERO');
  if (!Array.isArray(state.board) || state.board.some((c) => !CARD_RE.test(c)))
    throw new Error('VISION_STATE_INVALID_BOARD');
  if (!Array.isArray(state.legalActions) || state.legalActions.some((a) => !ACTIONS.has(a)))
    throw new Error('VISION_STATE_INVALID_ACTIONS');
  return state;
}

export function mergeConfirmedVision(previous, incoming) {
  const next = { ...previous, ...incoming };

  // A bad/inconclusive lane never erases a previously confirmed value.
  if (incoming.heroPresence === 'uncertain' || (incoming.heroPresence !== 'absent' && incoming.heroCards.length !== 2)) {
    next.heroCards = previous.heroCards;
    next.heroPresence = previous.heroPresence;
  }
  if (incoming.boardPresence === 'uncertain') {
    next.board = previous.board;
    next.boardPresence = previous.boardPresence;
  }
  if (!incoming.legalActions.length && previous.legalActions?.length)
    next.legalActions = previous.legalActions;
  if (!incoming.pot && previous.pot) next.pot = previous.pot;
  if (!incoming.heroStack && previous.heroStack) next.heroStack = previous.heroStack;
  if (!incoming.blinds && previous.blinds) next.blinds = previous.blinds;
  if (!incoming.toCall && previous.toCall) next.toCall = previous.toCall;

  next.version = VISION_STATE_VERSION;
  next.source = VISION_SOURCE;
  return assertVisionStateV1(next);
}
