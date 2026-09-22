const BOARD_COUNTS = new Set([0, 3, 4, 5]);
const ACTIONS = new Set(['FOLD','CHECK','CALL','BET','RAISE','ALLIN']);
const CARD = /^[2-9TJQKA][hdcs]$/;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const upper = (v) => String(v || '').toUpperCase();

/** Hard gate between fixed-layout reconstruction and the Brain.
 *
 * This validator is intentionally conservative. A recommendation is less
 * important than refusing to decide from stale cards, pre-action checkboxes,
 * time-bank text, incomplete action reconstruction or ambiguous money reads.
 */
export function validatePokerSnapshot(snapshot = {}) {
  const errors = [];
  const hero = Array.isArray(snapshot.heroCards) ? snapshot.heroCards : [];
  const board = Array.isArray(snapshot.board) ? snapshot.board : [];
  const buttons = Array.isArray(snapshot.heroButtons) ? snapshot.heroButtons.map(upper) : [];
  const history = Array.isArray(snapshot.actionHistory) ? snapshot.actionHistory : [];

  if (hero.length !== 2 || hero.some((c) => typeof c !== 'string' || !CARD.test(c))) errors.push('hero_cards_incomplete');
  if (snapshot.heroPresence !== 'present') errors.push('hero_not_present');
  if (!BOARD_COUNTS.has(board.length)) errors.push('partial_board');
  if (board.some((c) => typeof c !== 'string' || !CARD.test(c))) errors.push('board_decode_gap');

  const allCards=[...hero,...board].filter((c)=>typeof c==='string');
  if (new Set(allCards).size !== allCards.length) errors.push('duplicate_card');

  if (snapshot.heroTurnConfirmed !== true) errors.push('hero_turn_not_confirmed');
  if (snapshot.buttonsSource !== 'physical-action-buttons') errors.push('hero_buttons_source_invalid');
  if (buttons.length < 2 || buttons.length > 3) errors.push('hero_buttons_missing');
  if (buttons.some((a) => !ACTIONS.has(a))) errors.push('hero_buttons_invalid');

  if (!snapshot.heroPosition) errors.push('position_missing');
  if (snapshot.positionSource !== 'dealer-plus-occupied-seats-only') errors.push('position_source_invalid');
  if (snapshot.actionLedgerSource !== 'seat-state-ledger-v1') errors.push('action_ledger_source_invalid');
  if (snapshot.actionComplete !== true) errors.push('action_history_incomplete');

  if (!finite(snapshot.pot)) errors.push('pot_missing');
  else if (snapshot.pot <= 0) errors.push('pot_invalid');
  if (!finite(snapshot.heroStack)) errors.push('hero_stack_missing');
  else if (snapshot.heroStack <= 0) errors.push('hero_stack_invalid');
  if (!finite(snapshot.toCall)) errors.push('to_call_missing');
  else if (snapshot.toCall < 0) errors.push('to_call_negative');
  if (snapshot.toCallSource !== 'commitment-delta') errors.push('to_call_source_invalid');
  if (finite(snapshot.toCall) && finite(snapshot.heroStack) && snapshot.toCall > snapshot.heroStack + 1e-6) errors.push('to_call_exceeds_stack');

  if (finite(snapshot.toCall) && snapshot.toCall > 1e-6 && buttons.includes('CHECK')) errors.push('buttons_to_call_inconsistent');
  if (finite(snapshot.toCall) && snapshot.toCall <= 1e-6 && buttons.includes('CALL')) errors.push('buttons_to_call_inconsistent');

  for (const e of history) {
    if (!e || !ACTIONS.has(upper(e.action))) errors.push('action_history_invalid');
    if (finite(e.amount) && e.amount < 0) errors.push('action_amount_negative');
  }

  if (snapshot.currentAction && !buttons.includes(upper(snapshot.currentAction))) errors.push('recommended_action_not_legal');

  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export function gateBrainInput(snapshot, decide) {
  const validation = validatePokerSnapshot(snapshot);
  if (!validation.ok) return { decided: false, validation, decision: null };
  if (typeof decide !== 'function') throw new TypeError('decide must be a function');
  return { decided: true, validation, decision: decide(snapshot) };
}
