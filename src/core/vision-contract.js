export const VISION_VERSION = 'vision-v1';

export const VISION_V1_FIELDS = Object.freeze([
  'version',
  'heroCards',
  'heroPresence',
  'board',
  'boardPresence',
  'pot',
  'toCall',
  'legalActions',
  'players',
  'activePlayers',
  'heroPosition',
  'heroStack',
  'effectiveStack',
  'blinds',
  'seats',
  'actionHistory',
  'confidence',
  'readerModel',
  'capturedAt',
]);

const CARD = /^[2-9TJQKA][hdcs]$/;
const PRESENCE = new Set(['present', 'absent', 'uncertain', null]);
const ACTIONS = new Set(['FOLD', 'CHECK', 'CALL', 'BET', 'RAISE', 'ALLIN']);

const nullableString = (v) => v == null || typeof v === 'string';
const nullableNumber = (v) => v == null || Number.isFinite(v);

export function validateVisionStateV1(input) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['body must be an object'] };
  }
  if (input.version !== VISION_VERSION) errors.push(`version must be ${VISION_VERSION}`);

  const cards = (name, value, max) => {
    if (!Array.isArray(value)) return errors.push(`${name} must be an array`);
    if (value.length > max) errors.push(`${name} max length is ${max}`);
    for (const c of value) if (typeof c !== 'string' || !CARD.test(c)) errors.push(`${name} contains invalid card ${String(c)}`);
    if (new Set(value).size !== value.length) errors.push(`${name} contains duplicate cards`);
  };
  cards('heroCards', input.heroCards, 2);
  cards('board', input.board, 5);

  if (!PRESENCE.has(input.heroPresence ?? null)) errors.push('heroPresence invalid');
  if (!PRESENCE.has(input.boardPresence ?? null)) errors.push('boardPresence invalid');

  for (const k of ['pot', 'toCall', 'heroPosition', 'heroStack', 'effectiveStack', 'blinds', 'readerModel']) {
    if (!nullableString(input[k])) errors.push(`${k} must be string|null`);
  }
  for (const k of ['players', 'activePlayers']) {
    if (!nullableNumber(input[k])) errors.push(`${k} must be number|null`);
  }

  if (!Array.isArray(input.legalActions)) errors.push('legalActions must be an array');
  else for (const a of input.legalActions) if (!ACTIONS.has(a)) errors.push(`legalActions contains invalid action ${String(a)}`);

  if (!Array.isArray(input.seats)) errors.push('seats must be an array');
  if (!Array.isArray(input.actionHistory)) errors.push('actionHistory must be an array');

  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    errors.push('confidence must be a number from 0 to 1');
  }
  if (!Number.isFinite(input.capturedAt) || input.capturedAt <= 0) errors.push('capturedAt must be epoch milliseconds');

  const allCards = [...(Array.isArray(input.heroCards) ? input.heroCards : []), ...(Array.isArray(input.board) ? input.board : [])];
  if (new Set(allCards).size !== allCards.length) errors.push('heroCards and board overlap');

  return { ok: errors.length === 0, errors };
}

export function normalizeVisionStateV1(input) {
  const v = input && typeof input === 'object' ? input : {};
  return {
    version: VISION_VERSION,
    heroCards: Array.isArray(v.heroCards) ? v.heroCards.slice(0, 2) : [],
    heroPresence: PRESENCE.has(v.heroPresence ?? null) ? (v.heroPresence ?? null) : null,
    board: Array.isArray(v.board) ? v.board.slice(0, 5) : [],
    boardPresence: PRESENCE.has(v.boardPresence ?? null) ? (v.boardPresence ?? null) : null,
    pot: nullableString(v.pot) ? (v.pot ?? null) : null,
    toCall: nullableString(v.toCall) ? (v.toCall ?? null) : null,
    legalActions: Array.isArray(v.legalActions) ? v.legalActions.filter((a) => ACTIONS.has(a)) : [],
    players: nullableNumber(v.players) ? (v.players ?? null) : null,
    activePlayers: nullableNumber(v.activePlayers) ? (v.activePlayers ?? null) : null,
    heroPosition: nullableString(v.heroPosition) ? (v.heroPosition ?? null) : null,
    heroStack: nullableString(v.heroStack) ? (v.heroStack ?? null) : null,
    effectiveStack: nullableString(v.effectiveStack) ? (v.effectiveStack ?? null) : null,
    blinds: nullableString(v.blinds) ? (v.blinds ?? null) : null,
    seats: Array.isArray(v.seats) ? v.seats.slice(0, 10) : [],
    actionHistory: Array.isArray(v.actionHistory) ? v.actionHistory.filter((x) => typeof x === 'string').slice(-24) : [],
    confidence: typeof v.confidence === 'number' && Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : 0,
    readerModel: nullableString(v.readerModel) ? (v.readerModel ?? null) : null,
    capturedAt: Number.isFinite(v.capturedAt) ? v.capturedAt : Date.now(),
  };
}
