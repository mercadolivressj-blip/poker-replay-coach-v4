const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const finite = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
const money = (v) => Math.round((Number(v)+Number.EPSILON)*100)/100;

export function inferSeatAction(prev = {}, cur = {}, { tableMaxBefore = 0, epsilon = 0.02 } = {}) {
  const pCommit = n(prev.commitment);
  const cCommit = n(cur.commitment);
  const pStack = prev.stack == null ? null : n(prev.stack);
  const cStack = cur.stack == null ? null : n(cur.stack);
  const delta = cCommit - pCommit;
  const tableMax = n(tableMaxBefore);
  const cardsDropped = prev.cardsPresent === true && cur.cardsPresent === false;
  const turnEnded = prev.turn === true && cur.turn === false;
  const facingBet = pCommit + epsilon < tableMax;

  // Money evidence is stronger than card disappearance. This prevents a later
  // table cleanup from erasing a call/raise/all-in that was already visible.
  if (pStack != null && cStack != null && pStack > epsilon && cStack <= epsilon && delta > epsilon) {
    return { action:'ALLIN', amount:cCommit, source:'commitment-plus-stack-delta' };
  }
  if (delta > epsilon) {
    if (cCommit > tableMax + epsilon) return { action: tableMax > epsilon ? 'RAISE' : 'BET', amount:cCommit, source:'commitment-delta' };
    return { action:'CALL', amount:cCommit, source:'commitment-delta' };
  }

  // Card disappearance is authoritative for a fast fold only while the player
  // still owes chips. We intentionally do not require a visible turn ring here:
  // short PokerStars folds can happen between sampled turn-indicator frames.
  if (cardsDropped && facingBet) {
    return { action:'FOLD', amount:null, source:'card-presence-delta-facing-bet' };
  }

  // If nothing was owed, a completed turn with no commitment increase is a
  // CHECK even when PokerStars clears the cards immediately afterwards at the
  // end of a street/hand. This avoids the historical CHECK -> FOLD false event.
  if (turnEnded && Math.abs(delta) <= epsilon) {
    if (facingBet) return null;
    return { action:'CHECK', amount:null, source:'turn-plus-commitment-delta' };
  }

  // Cards disappearing while no bet was pending and without an observed turn
  // transition is ambiguous (showdown/cleanup/new-hand animation). Abstain.
  return null;
}

/** Canonical to-call calculation. Button OCR/time-bank text is never an input. */
export function computeToCallFromCommitments(seatsInput = {}, heroId = 'hero') {
  const rows = Array.isArray(seatsInput)
    ? seatsInput.map((row,i)=>[String(row?.id ?? i),row])
    : Object.entries(seatsInput || {});
  const hero = rows.find(([id])=>id===heroId)?.[1];
  if (!hero || !finite(hero.commitment)) return { value:null, source:'commitment-delta', reason:'hero-commitment-missing' };

  const eligible = rows.filter(([,row]) => row && row.folded !== true && row.cardsPresent !== false && finite(row.commitment));
  if (!eligible.length) return { value:null, source:'commitment-delta', reason:'table-commitments-missing' };
  const heroCommitment=Number(hero.commitment);
  const tableMax=Math.max(...eligible.map(([,row])=>Number(row.commitment)));
  const value=money(Math.max(0,tableMax-heroCommitment));
  return { value, source:'commitment-delta', heroCommitment:money(heroCommitment), tableMax:money(tableMax) };
}

export function updateSeatObservation(prev = {}, observed = {}) {
  return {
    cardsPresent: observed.cardsPresent ?? prev.cardsPresent ?? null,
    stack: observed.stack ?? prev.stack ?? null,
    previousCommitment: prev.commitment ?? prev.previousCommitment ?? 0,
    commitment: observed.commitment ?? prev.commitment ?? 0,
    turn: observed.turn ?? prev.turn ?? false,
    occupied: observed.occupied ?? prev.occupied ?? false,
    folded: observed.folded ?? prev.folded ?? false,
  };
}
