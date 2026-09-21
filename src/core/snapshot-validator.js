const BOARD_COUNTS = new Set([0, 3, 4, 5]);
const ACTIONS = new Set(['FOLD','CHECK','CALL','BET','RAISE','ALLIN']);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Hard gate between vision/state reconstruction and the Brain. */
export function validatePokerSnapshot(snapshot = {}) {
  const errors = [];
  const hero = Array.isArray(snapshot.heroCards) ? snapshot.heroCards : [];
  const board = Array.isArray(snapshot.board) ? snapshot.board : [];
  const buttons = Array.isArray(snapshot.heroButtons) ? snapshot.heroButtons : [];
  const history = Array.isArray(snapshot.actionHistory) ? snapshot.actionHistory : [];

  if (hero.length !== 2 || hero.some((c) => !c)) errors.push('hero_cards_incomplete');
  if (!BOARD_COUNTS.has(board.length)) errors.push('partial_board');
  if (board.some((c) => !c)) errors.push('board_decode_gap');
  if (buttons.length === 0) errors.push('hero_buttons_missing');
  if (!snapshot.heroPosition) errors.push('position_missing');
  if (snapshot.positionSource && snapshot.positionSource !== 'dealer-plus-occupied-seats-only') errors.push('position_source_invalid');
  if (snapshot.actionComplete !== true) errors.push('action_history_incomplete');

  if (finite(snapshot.toCall) && snapshot.toCall < 0) errors.push('to_call_negative');
  if (finite(snapshot.toCall) && finite(snapshot.heroStack) && snapshot.toCall > snapshot.heroStack + 1e-6) errors.push('to_call_exceeds_stack');
  if (finite(snapshot.pot) && snapshot.pot < 0) errors.push('pot_negative');

  for (const e of history) {
    if (!e || !ACTIONS.has(String(e.action || '').toUpperCase())) errors.push('action_history_invalid');
    if (finite(e.amount) && e.amount < 0) errors.push('action_amount_negative');
  }

  if (snapshot.currentAction && buttons.length && !buttons.map((x) => String(x).toUpperCase()).includes(String(snapshot.currentAction).toUpperCase())) {
    errors.push('recommended_action_not_legal');
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function gateBrainInput(snapshot, decide) {
  const validation = validatePokerSnapshot(snapshot);
  if (!validation.ok) return { decided: false, validation, decision: null };
  if (typeof decide !== 'function') throw new TypeError('decide must be a function');
  return { decided: true, validation, decision: decide(snapshot) };
}
